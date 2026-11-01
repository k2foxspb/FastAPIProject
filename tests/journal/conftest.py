"""
Общие фикстуры тестов «Журнала жизни».

Каждый тест получает свою SQLite-базу (aiosqlite) во временной папке, двух
пользователей и httpx-клиент к приложению FastAPI. Текущий пользователь
подменяется через dependency_overrides (переключается фикстурой `as_user`).
Файловое хранилище перенаправлено во временную папку.
"""
import os
from types import SimpleNamespace

import pytest
import pytest_asyncio

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

import httpx  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.api.dependencies import get_async_db  # noqa: E402
from app.core import rate_limit  # noqa: E402
from app.core.celery_app import celery_app  # noqa: E402
from app.core.auth import get_current_user  # noqa: E402
from app.database import Base  # noqa: E402
from app.main import app  # noqa: E402
from app.models.users import User  # noqa: E402
from app.utils import storage as storage_service  # noqa: E402
from app.utils.local_storage import LocalStorageService  # noqa: E402


@pytest_asyncio.fixture
async def session_maker(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'journal.db').as_posix()}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    yield maker
    await engine.dispose()


@pytest_asyncio.fixture
async def users(session_maker):
    async with session_maker() as db:
        alice = User(email="alice@example.com", hashed_password="x", first_name="Алиса")
        bob = User(email="bob@example.com", hashed_password="x", first_name="Боб")
        db.add_all([alice, bob])
        await db.commit()
        return SimpleNamespace(alice=SimpleNamespace(id=alice.id), bob=SimpleNamespace(id=bob.id))


@pytest.fixture
def storage_dir(tmp_path, monkeypatch):
    disk = tmp_path / "storage"
    disk.mkdir()
    monkeypatch.setattr(storage_service, "_service", LocalStorageService(disks=[str(disk)]))
    return disk


@pytest_asyncio.fixture
async def client(session_maker, users, storage_dir, monkeypatch):
    current = {"user": users.alice}

    async def override_db():
        async with session_maker() as session:
            yield session

    async def override_user():
        return current["user"]

    # Redis в тестах не нужен - сразу используем счётчики в памяти
    monkeypatch.setattr(rate_limit, "_redis_down_until", float("inf"))
    # Celery broker is external; individual tests can replace this stub to assert failure handling.
    monkeypatch.setitem(celery_app.__dict__, "send_task", lambda *args, **kwargs: None)
    rate_limit.reset_memory_counters()

    app.dependency_overrides[get_async_db] = override_db
    app.dependency_overrides[get_current_user] = override_user
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as http:
        http.current = current
        http.users = users
        yield http
    app.dependency_overrides.clear()


@pytest.fixture
def as_user(client):
    """Переключает текущего пользователя: as_user(client.users.bob)."""
    def _switch(user):
        client.current["user"] = user
    return _switch
