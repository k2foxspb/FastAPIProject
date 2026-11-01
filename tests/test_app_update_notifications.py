"""
Рассылка уведомления о новой версии приложения при её добавлении в админке
(POST /admin/upload-app): всем активным незаблокированным пользователям
создаётся запись в колокольчике и отправляется push типа app_update со ссылкой на APK.
"""
import asyncio
import os
from types import SimpleNamespace

import pytest
import pytest_asyncio

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

import httpx  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

import app.database as database  # noqa: E402
from app.api.dependencies import get_async_db  # noqa: E402
from app.core import notifications as core_notifications  # noqa: E402
from app.core import rate_limit  # noqa: E402
from app.core.auth import get_current_owner  # noqa: E402
from app.database import Base  # noqa: E402
from app.main import app  # noqa: E402
from app.models.notifications import Notification  # noqa: E402
from app.models.users import User  # noqa: E402


@pytest_asyncio.fixture
async def session_maker(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'app_update.db').as_posix()}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    yield maker
    await engine.dispose()


@pytest_asyncio.fixture
async def users(session_maker):
    async with session_maker() as db:
        owner = User(email="owner@example.com", hashed_password="x", role="owner", fcm_token="tok-owner")
        alice = User(email="alice@example.com", hashed_password="x", fcm_token="tok-alice")
        banned = User(email="banned@example.com", hashed_password="x", is_banned=True, fcm_token="tok-banned")
        db.add_all([owner, alice, banned])
        await db.commit()
        return SimpleNamespace(owner=owner, alice=alice, banned=banned)


@pytest_asyncio.fixture
async def client(session_maker, users, monkeypatch):
    sent = []

    async def fake_send(token, title, body, data=None, **kwargs):
        sent.append({"token": token, "title": title, "body": body, "data": data})
        return True

    monkeypatch.setattr(core_notifications, "send_fcm_notification", fake_send)
    monkeypatch.setattr(database, "async_session_maker", session_maker)
    monkeypatch.setattr(rate_limit, "_redis_down_until", float("inf"))
    rate_limit.reset_memory_counters()

    async def override_db():
        async with session_maker() as session:
            yield session

    async def override_owner():
        return users.owner

    app.dependency_overrides[get_async_db] = override_db
    app.dependency_overrides[get_current_owner] = override_owner
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as http:
        http.sent = sent
        yield http
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_new_version_notifies_all_users(client, session_maker, users):
    res = await client.post("/admin/upload-app", data={"version": "1.0.22", "file_path": "/media/app/app_v1_0_22.apk"})
    assert res.status_code == 200, res.text
    version_id = res.json()["id"]

    await asyncio.sleep(0.1)  # push отправляется через asyncio.create_task

    async with session_maker() as db:
        notifs = (await db.execute(select(Notification))).scalars().all()

    by_user = {n.user_id: n for n in notifs}
    assert set(by_user) == {users.owner.id, users.alice.id}  # заблокированный не получает
    n = by_user[users.alice.id]
    assert n.notif_type == "app_update"
    assert "1.0.22" in n.body
    assert n.data["object_type"] == "app_version"
    assert n.data["object_id"] == version_id
    assert n.data["file_path"].startswith("http") and n.data["file_path"].endswith("/media/app/app_v1_0_22.apk")

    tokens = {p["token"] for p in client.sent}
    assert tokens == {"tok-owner", "tok-alice"}
    push = next(p for p in client.sent if p["token"] == "tok-alice")
    assert push["data"]["type"] == "app_update"
    assert push["data"]["version"] == "1.0.22"
    assert push["data"]["notification_id"] == n.id


@pytest.mark.asyncio
async def test_new_version_without_notification(client, session_maker):
    res = await client.post(
        "/admin/upload-app",
        data={"version": "1.0.23", "file_path": "/media/app/x.apk", "notify_users": "false"},
    )
    assert res.status_code == 200, res.text
    await asyncio.sleep(0.1)

    async with session_maker() as db:
        notifs = (await db.execute(select(Notification))).scalars().all()
    assert notifs == []
    assert client.sent == []
