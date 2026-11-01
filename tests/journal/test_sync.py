"""Синхронизация журнала: идемпотентность, LWW, tombstones, пагинация, лимиты, курсор."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import select, update

from app.core import config
from app.models.journal import JournalSyncState
from app.services.journal.seed import seed_uuid
from tests.journal.helpers import change, diary, new_uuid, pull_all, push, tracker, ts

pytestmark = pytest.mark.asyncio


async def test_push_then_pull_returns_entity_and_seed(client):
    uid = new_uuid()
    result = await push(client, change("diary_entry", uid, diary(tags=["#Отпуск", "отпуск", " море "])))
    assert result["results"][0]["status"] == "applied"

    changes, cursor = await pull_all(client)
    by_entity = {c["entity"]: c for c in changes}
    assert by_entity["settings"]["client_uuid"] == seed_uuid(client.users.alice.id, "settings")
    entry = by_entity["diary_entry"]
    assert entry["client_uuid"] == uid
    assert entry["data"]["body"] == "Текст"
    assert entry["data"]["tags"] == ["Отпуск", "море"]
    assert "id" not in entry["data"] and "user_id" not in entry["data"]
    assert cursor >= result["cursor"]


async def test_repeated_push_is_idempotent(client):
    batch = [change("diary_entry", new_uuid(), diary()), change("tracker", new_uuid(), tracker())]
    first = await push(client, *batch)
    second = await push(client, *batch)
    assert [r["status"] for r in second["results"]] == ["applied", "applied"]
    assert [r["server_rev"] for r in first["results"]] == [r["server_rev"] for r in second["results"]]
    assert second["cursor"] == first["cursor"]

    changes, _ = await pull_all(client, since=first["cursor"])
    assert changes == []


async def test_last_write_wins(client):
    uid = new_uuid()
    await push(client, change("diary_entry", uid, diary(body="новее"), at=ts(100)))

    stale = await push(client, change("diary_entry", uid, diary(body="старее"), at=ts(50)))
    result = stale["results"][0]
    assert result["status"] == "stale"
    assert result["current"]["data"]["body"] == "новее"

    newer = await push(client, change("diary_entry", uid, diary(body="самое новое"), at=ts(200)))
    assert newer["results"][0]["status"] == "applied"
    changes, _ = await pull_all(client)
    assert [c["data"]["body"] for c in changes if c["entity"] == "diary_entry"] == ["самое новое"]


async def test_future_updated_at_is_clamped_to_now(client):
    uid = new_uuid()
    await push(client, change("diary_entry", uid, diary(body="из будущего"), at="2099-01-01T00:00:00+00:00"))
    changes, _ = await pull_all(client)
    entry = next(c for c in changes if c["entity"] == "diary_entry")
    assert datetime.fromisoformat(entry["data"]["updated_at"]) <= datetime.now(timezone.utc)

    # Правка с реальным текущим временем не должна проиграть «будущей» метке
    later = await push(client, change("diary_entry", uid, diary(body="сейчас"),
                                      at=datetime.now(timezone.utc).isoformat()))
    assert later["results"][0]["status"] == "applied"


async def test_delete_creates_tombstone_and_cascades(client):
    tracker_uuid, value_uuid = new_uuid(), new_uuid()
    first = await push(
        client,
        change("tracker", tracker_uuid, tracker()),
        change("tracker_value", value_uuid, {"tracker_uuid": tracker_uuid, "value_date": "2025-03-01", "num_value": 81.5}),
    )
    assert [r["status"] for r in first["results"]] == ["applied", "applied"]

    deleted = await push(client, change("tracker", tracker_uuid, op="delete", at=ts(10)))
    assert deleted["results"][0]["status"] == "applied"

    changes, _ = await pull_all(client, since=first["cursor"])
    tombstones = {c["entity"]: c for c in changes}
    assert set(tombstones) == {"tracker", "tracker_value"}
    for c in tombstones.values():
        assert c["deleted_at"] is not None
        assert c["data"] is None

    # Повторное удаление идемпотентно, удаление неизвестной записи - не ошибка
    again = await push(client, change("tracker", tracker_uuid, op="delete", at=ts(10)),
                       change("diary_entry", new_uuid(), op="delete"))
    assert [r["status"] for r in again["results"]] == ["applied", "applied"]


async def test_children_after_parents_in_one_batch(client):
    tracker_uuid = new_uuid()
    # Ребёнок раньше родителя в пачке - сервер всё равно применяет родителя первым
    result = await push(
        client,
        change("tracker_value", new_uuid(), {"tracker_uuid": tracker_uuid, "value_date": "2025-03-02", "num_value": 1}),
        change("tracker", tracker_uuid, tracker("Привычка", "bool")),
    )
    assert [r["status"] for r in result["results"]] == ["applied", "applied"]


async def test_missing_ref_rejected(client):
    result = await push(client, change(
        "tracker_value", new_uuid(), {"tracker_uuid": new_uuid(), "value_date": "2025-03-01", "num_value": 1}
    ))
    assert result["results"][0]["status"] == "rejected"
    assert result["results"][0]["reason"] == "missing_ref:tracker_uuid"


@pytest.mark.parametrize("entity,data,reason_part", [
    ("diary_entry", {"entry_date": "2025-03-01", "mood": 7}, "mood"),
    ("diary_entry", {"entry_date": "1900-01-01"}, "entry_date"),
    ("diary_entry", {"entry_date": "2025-03-01", "body": "x" * 20001}, "body"),
    ("tracker", {"name": "Шкала", "value_type": "scale", "scale_min": 5, "scale_max": 1}, "scale"),
    ("event", {"kind": "note", "title": "Заметка", "start_date": "2025-03-01", "rrule": "FREQ=YEARLY"}, "rrule"),
    ("event", {"kind": "workout", "title": "Тренировка", "start_date": "2025-03-01"}, "kind"),
    ("unknown_entity", {}, "unknown_entity"),
])
async def test_invalid_data_rejected(client, entity, data, reason_part):
    result = await push(client, change(entity, new_uuid(), data))
    assert result["results"][0]["status"] == "rejected"
    assert reason_part in result["results"][0]["reason"]


async def test_tracker_value_checked_against_tracker_type(client):
    habit = new_uuid()
    await push(client, change("tracker", habit, tracker("Привычка", "bool")))
    result = await push(client, change(
        "tracker_value", new_uuid(), {"tracker_uuid": habit, "value_date": "2025-03-01", "num_value": 2}
    ))
    assert result["results"][0]["status"] == "rejected"


async def test_event_rrule_normalized_and_until_copied(client):
    uid = new_uuid()
    await push(client, change("event", uid, {
        "kind": "meal", "title": "Обед", "start_date": "2025-03-01", "start_time": "13:00",
        "rrule": "freq=weekly;byday=fr,mo;until=20250331",
    }))
    changes, _ = await pull_all(client)
    event = next(c for c in changes if c["entity"] == "event")["data"]
    assert event["rrule"] == "FREQ=WEEKLY;BYDAY=MO,FR;UNTIL=20250331"
    assert event["until_date"] == "2025-03-31"
    assert event["start_time"] == "13:00:00"


async def test_settings_singleton(client):
    await pull_all(client)  # создаёт стартовые настройки
    own = seed_uuid(client.users.alice.id, "settings")
    ok = await push(client, change("settings", own, {"timezone": "Europe/Berlin", "kcal_goal": 2000},
                                   at=datetime.now(timezone.utc).isoformat()))
    assert ok["results"][0]["status"] == "applied"
    other = await push(client, change("settings", new_uuid(), {"timezone": "Europe/Moscow"}))
    assert other["results"][0]["reason"] == "settings_exists"
    bad_tz = await push(client, change("settings", own, {"timezone": "Mars/Olympus"},
                                       at=datetime.now(timezone.utc).isoformat()))
    assert bad_tz["results"][0]["status"] == "rejected"
    deleted = await push(client, change("settings", own, op="delete"))
    assert deleted["results"][0]["reason"] == "op_not_allowed"


async def test_pull_pagination(client):
    await push(client, *[change("diary_entry", new_uuid(), diary(f"2025-03-0{i}")) for i in range(1, 6)])
    first = (await client.get("/api/journal/sync/pull", params={"since": 0, "limit": 2})).json()
    assert len(first["changes"]) == 2 and first["has_more"] is True
    revs = [c["server_rev"] for c in first["changes"]]
    assert revs == sorted(revs) and first["cursor"] == revs[-1]

    changes, _ = await pull_all(client, since=first["cursor"], limit=2)
    total = first["changes"] + changes
    assert len([c for c in total if c["entity"] == "diary_entry"]) == 5
    assert len({c["server_rev"] for c in total}) == len(total)


async def test_batch_limits(client, monkeypatch):
    too_many = [change("diary_entry", new_uuid(), diary()) for _ in range(config.JOURNAL_SYNC_MAX_CHANGES + 1)]
    response = await client.post("/api/journal/sync/push", json={"changes": too_many})
    assert response.status_code == 413

    monkeypatch.setattr(config, "JOURNAL_SYNC_MAX_BYTES", 200)
    response = await client.post("/api/journal/sync/push",
                                 json={"changes": [change("diary_entry", new_uuid(), diary(body="x" * 500))]})
    assert response.status_code == 413

    response = await client.post("/api/journal/sync/push",
                                 json={"changes": [{"entity": "diary_entry", "client_uuid": "nope", "op": "x"}]})
    assert response.status_code == 422


async def test_stale_cursor_returns_410(client, session_maker):
    result = await push(client, change("diary_entry", new_uuid(), diary()), change("diary_entry", new_uuid(), diary()))
    assert result["cursor"] >= 2
    response = await client.get("/api/journal/sync/pull", params={"since": result["cursor"] + 100})
    assert response.status_code == 410

    async with session_maker() as db:
        await db.execute(update(JournalSyncState)
                         .where(JournalSyncState.user_id == client.users.alice.id)
                         .values(purged_rev=result["cursor"]))
        await db.commit()
        state = (await db.execute(select(JournalSyncState))).scalar_one()
        assert state.purged_rev == result["cursor"]
    response = await client.get("/api/journal/sync/pull", params={"since": 1})
    assert response.status_code == 410
    # since=0 - полная синхронизация, она разрешена всегда
    assert (await client.get("/api/journal/sync/pull", params={"since": 0})).status_code == 200


async def test_meta(client):
    body = (await client.get("/api/journal/sync/meta")).json()
    assert body["user_id"] == client.users.alice.id
    assert body["entities"][0] == "settings" and "attachment" in body["entities"]
    assert {t["template_key"] for t in body["tracker_templates"]} == {"weight", "sleep", "mood", "wellbeing", "habit", "pulse"}
