"""Изоляция данных журнала между пользователями (IDOR): sync, вложения, календарь, /media."""
import io
from urllib.parse import quote

import pytest
from sqlalchemy import select

from app.models.journal import JournalAttachment
from tests.journal.helpers import change, diary, new_uuid, pull_all, push, tracker

pytestmark = pytest.mark.asyncio

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


async def _alice_diary(client, body="секрет Алисы", entry_date="2025-03-01"):
    uid = new_uuid()
    await push(client, change("diary_entry", uid, diary(entry_date, body)))
    return uid


async def _upload(client, owner_uuid, att_uuid=None, content=PNG_BYTES, owner_type="diary_entry"):
    return await client.post(
        "/api/journal/attachments",
        data={"client_uuid": att_uuid or new_uuid(), "owner_type": owner_type, "owner_uuid": owner_uuid},
        files={"file": ("photo.png", io.BytesIO(content), "image/png")},
    )


async def test_foreign_refs_rejected_in_sync(client, as_user):
    tracker_uuid, event_uuid = new_uuid(), new_uuid()
    await push(client, change("tracker", tracker_uuid, tracker()),
               change("event", event_uuid, {"kind": "note", "title": "Событие", "start_date": "2025-03-01"}))

    as_user(client.users.bob)
    result = await push(
        client,
        change("tracker_value", new_uuid(), {"tracker_uuid": tracker_uuid, "value_date": "2025-03-01", "num_value": 70}),
        change("event_occurrence", new_uuid(), {"event_uuid": event_uuid, "occurrence_date": "2025-03-01", "status": "done"}),
        change("reminder", new_uuid(), {"target_type": "event", "target_uuid": event_uuid}),
        change("event", new_uuid(), {"kind": "tracker", "title": "Взвеситься", "start_date": "2025-03-01",
                                     "ref_type": "tracker", "ref_uuid": tracker_uuid}),
    )
    assert [r["status"] for r in result["results"]] == ["rejected"] * 4
    assert all(r["reason"].startswith("missing_ref") for r in result["results"])


async def test_same_uuid_of_other_user_does_not_touch_owner_data(client, as_user):
    uid = await _alice_diary(client)

    as_user(client.users.bob)
    overwrite = await push(client, change("diary_entry", uid, diary(body="взлом"), at="2030-01-01T00:00:00+00:00"))
    assert overwrite["results"][0]["status"] == "applied"  # создана отдельная запись Боба
    delete = await push(client, change("diary_entry", uid, op="delete", at="2030-01-02T00:00:00+00:00"))
    assert delete["results"][0]["status"] == "applied"
    bob_changes, _ = await pull_all(client)
    assert all(c["data"] is None or c["data"].get("body") != "секрет Алисы" for c in bob_changes)

    as_user(client.users.alice)
    alice_changes, _ = await pull_all(client)
    entry = next(c for c in alice_changes if c["client_uuid"] == uid)
    assert entry["deleted_at"] is None and entry["data"]["body"] == "секрет Алисы"


async def test_calendar_and_day_are_private(client, as_user):
    await _alice_diary(client, entry_date="2025-03-05")
    as_user(client.users.bob)
    month = (await client.get("/api/journal/calendar", params={"month": "2025-03"})).json()
    assert not any(d["has_diary"] for d in month["days"])
    day = (await client.get("/api/journal/day", params={"date": "2025-03-05"})).json()
    assert day["diary_entries"] == []


async def test_attachment_upload_is_idempotent_and_owner_only(client, as_user, session_maker):
    owner = await _alice_diary(client)
    att_uuid = new_uuid()

    first = await _upload(client, owner, att_uuid)
    assert first.status_code == 201, first.text
    again = await _upload(client, owner, att_uuid)
    assert again.status_code == 200
    assert again.json()["server_rev"] == first.json()["server_rev"]

    ok = await client.get(f"/api/journal/attachments/{att_uuid}/file")
    assert ok.status_code == 200 and ok.content == PNG_BYTES

    # Вложение доезжает до других устройств через sync pull
    changes, _ = await pull_all(client)
    att = next(c for c in changes if c["entity"] == "attachment")
    assert att["data"]["owner_uuid"] == owner and att["data"]["mime"] == "image/png"
    assert "storage_key" not in att["data"]

    as_user(client.users.bob)
    assert (await client.get(f"/api/journal/attachments/{att_uuid}/file")).status_code == 404
    assert (await client.get("/api/journal/attachments/not-a-uuid/file")).status_code == 404
    # Нельзя прикрепить файл к чужой записи
    assert (await _upload(client, owner)).status_code == 409
    # Нельзя удалить чужое вложение через sync
    await push(client, change("attachment", att_uuid, op="delete", at="2030-01-01T00:00:00+00:00"))
    as_user(client.users.alice)
    assert (await client.get(f"/api/journal/attachments/{att_uuid}/file")).status_code == 200


async def test_attachment_type_and_size_limits(client, monkeypatch):
    owner = await _alice_diary(client)
    assert (await _upload(client, owner, content=b"GIF89a....")).status_code == 415
    assert (await _upload(client, owner, owner_type="users")).status_code == 422

    from app.core import config
    monkeypatch.setattr(config, "JOURNAL_ATTACHMENT_MAX_BYTES", 32)
    assert (await _upload(client, owner)).status_code == 413


async def test_deleting_owner_deletes_attachment(client):
    owner = await _alice_diary(client)
    att_uuid = new_uuid()
    assert (await _upload(client, owner, att_uuid)).status_code == 201
    await push(client, change("diary_entry", owner, op="delete", at="2030-01-01T00:00:00+00:00"))
    assert (await client.get(f"/api/journal/attachments/{att_uuid}/file")).status_code == 404


async def test_media_route_does_not_serve_journal_files(client, session_maker):
    owner = await _alice_diary(client)
    att_uuid = new_uuid()
    assert (await _upload(client, owner, att_uuid)).status_code == 201
    async with session_maker() as db:
        key = (await db.execute(select(JournalAttachment.storage_key))).scalar_one()
    relative = key.partition(":")[2]
    assert relative.startswith("journal/u")

    for path in (relative, quote(relative), key, relative.replace("journal/", "Journal/", 1),
                 relative.replace("journal/", "./journal/", 1)):
        response = await client.get(f"/media/{path}")
        assert response.status_code == 404, path
