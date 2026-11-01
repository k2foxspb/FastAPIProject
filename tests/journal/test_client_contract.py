"""
Контракт с мобильным клиентом: пачка в том виде, в каком её собирает
mobile/src/journal/sync (rowToPayload): все поля сущности, null для пустых,
время 'HH:MM', исключение повторения с UUIDv5 от события и даты.
"""
import uuid

import pytest

from app.services.journal.seed import NS_JOURNAL
from tests.journal.helpers import change, new_uuid, pull_all, push

pytestmark = pytest.mark.asyncio


def occurrence_uuid(event_uuid: str, original_date: str) -> str:
    # То же, что occurrenceUuid() в mobile/src/journal/utils/uuid.js
    return str(uuid.uuid5(NS_JOURNAL, f"occ:{event_uuid}:{original_date}"))


async def test_client_shaped_batch_is_accepted_and_round_trips(client):
    tracker_uuid, value_uuid, event_uuid, diary_uuid = new_uuid(), new_uuid(), new_uuid(), new_uuid()
    occ_uuid = occurrence_uuid(event_uuid, "2025-03-04")
    batch = [
        change("tracker", tracker_uuid, {
            "name": "Вес", "value_type": "number", "unit": "кг", "icon": "scale-outline", "color": "#4F8EF7",
            "scale_min": None, "scale_max": None, "frequency": "daily", "goal_value": 80, "goal_direction": "reach",
            "template_key": "weight", "sort_order": 0, "archived": False,
        }),
        change("tracker_value", value_uuid, {
            "tracker_uuid": tracker_uuid, "value_date": "2025-03-04", "value_time": "08:15",
            "num_value": 81.4, "text_value": None, "note": None,
        }),
        change("event", event_uuid, {
            "kind": "custom", "title": "Обед", "description": None, "start_date": "2025-03-03", "start_time": "13:00",
            "timezone": "Europe/Moscow", "duration_min": None, "rrule": "FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=20250331",
            "until_date": "2025-03-31", "status": "planned", "ref_type": None, "ref_uuid": None, "payload": None,
            "color": "#10B981",
        }),
        change("event_occurrence", occ_uuid, {
            "event_uuid": event_uuid, "occurrence_date": "2025-03-04", "status": "done", "moved_date": None,
            "moved_time": None, "done_at": "2025-03-04T10:05:00.000Z", "note": None,
        }),
        change("diary_entry", diary_uuid, {
            "entry_date": "2025-03-04", "entry_time": "21:30", "title": None, "body": "Хороший день",
            "body_format": "plain", "mood": 4, "tags": ["работа"],
        }),
    ]
    result = await push(client, *batch)
    assert [r["status"] for r in result["results"]] == ["applied"] * len(batch), result

    changes, _cursor = await pull_all(client)
    pulled = {c["client_uuid"]: c for c in changes}
    assert pulled[value_uuid]["data"]["tracker_uuid"] == tracker_uuid
    assert pulled[value_uuid]["data"]["value_time"].startswith("08:15")
    assert pulled[occ_uuid]["data"]["event_uuid"] == event_uuid
    assert pulled[event_uuid]["data"]["rrule"] == "FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=20250331"

    # Календарь сервера видит выполнение, отмеченное клиентом
    month = (await client.get("/api/journal/calendar", params={"month": "2025-03"})).json()
    day = next(d for d in month["days"] if d["date"] == "2025-03-04")
    assert day["events_total"] == 1 and day["events_done"] == 1 and day["has_diary"] is True


async def test_same_occurrence_from_two_devices_merges(client):
    event_uuid = new_uuid()
    await push(client, change("event", event_uuid, {
        "kind": "custom", "title": "Вода", "start_date": "2025-03-01", "rrule": "FREQ=DAILY",
    }))
    occ_uuid = occurrence_uuid(event_uuid, "2025-03-02")
    data = {"event_uuid": event_uuid, "occurrence_date": "2025-03-02", "status": "done"}
    first = await push(client, change("event_occurrence", occ_uuid, data, at="2025-03-02T10:00:00+00:00"))
    second = await push(client, change("event_occurrence", occ_uuid, {**data, "status": "skipped"}, at="2025-03-02T11:00:00+00:00"))
    assert first["results"][0]["status"] == "applied"
    assert second["results"][0]["status"] == "applied"
