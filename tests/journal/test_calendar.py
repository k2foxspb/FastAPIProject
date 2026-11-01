"""Агрегаты календаря: повторяющиеся события с исключениями, дневник, экран дня."""
import pytest

from tests.journal.helpers import change, diary, new_uuid, push

pytestmark = pytest.mark.asyncio


async def _setup(client):
    lunch, dentist = new_uuid(), new_uuid()
    removed = new_uuid()
    await push(
        client,
        change("event", lunch, {"kind": "meal", "title": "Обед", "start_date": "2025-03-01",
                                "start_time": "13:00", "rrule": "FREQ=DAILY", "timezone": "Europe/Moscow"}),
        change("event", dentist, {"kind": "custom", "title": "Стоматолог", "start_date": "2025-03-10",
                                  "start_time": "09:00", "status": "done"}),
        change("event_occurrence", new_uuid(), {"event_uuid": lunch, "occurrence_date": "2025-03-02", "status": "done"}),
        change("event_occurrence", new_uuid(), {"event_uuid": lunch, "occurrence_date": "2025-03-03",
                                                "status": "cancelled"}),
        change("event_occurrence", new_uuid(), {"event_uuid": lunch, "occurrence_date": "2025-03-04",
                                                "moved_date": "2025-04-02", "moved_time": "14:30"}),
        change("diary_entry", new_uuid(), diary("2025-03-05")),
        change("diary_entry", removed, diary("2025-03-06")),
    )
    await push(client, change("diary_entry", removed, op="delete", at="2030-01-01T00:00:00+00:00"))
    return lunch


async def test_month_summary(client):
    await _setup(client)
    response = await client.get("/api/journal/calendar", params={"month": "2025-03"})
    assert response.status_code == 200
    body = response.json()
    assert body["month"] == "2025-03" and len(body["days"]) == 31
    days = {d["date"][-2:]: d for d in body["days"]}

    assert (days["01"]["events_total"], days["01"]["events_done"]) == (1, 0)
    assert (days["02"]["events_total"], days["02"]["events_done"]) == (1, 1)
    assert days["03"]["events_total"] == 0      # отменено
    assert days["04"]["events_total"] == 0      # перенесено на 2 апреля
    assert (days["10"]["events_total"], days["10"]["events_done"]) == (2, 1)
    assert days["05"]["has_diary"] is True
    assert days["06"]["has_diary"] is False     # запись удалена
    assert days["31"]["events_total"] == 1
    assert all(d["kcal"] == 0 and d["expense_kop"] == 0 for d in body["days"])


async def test_moved_occurrence_appears_in_target_month(client):
    lunch = await _setup(client)
    april = (await client.get("/api/journal/calendar", params={"month": "2025-04"})).json()
    assert april["days"][1]["events_total"] == 2   # 2 апреля: обычный обед + перенесённый

    day = (await client.get("/api/journal/day", params={"date": "2025-04-02"})).json()
    moved = [e for e in day["events"] if e["original_date"] == "2025-03-04"]
    assert len(moved) == 1
    assert moved[0]["event_uuid"] == lunch and moved[0]["time"] == "14:30:00"
    assert [e["time"] for e in day["events"]] == ["13:00:00", "14:30:00"]


async def test_day_details(client):
    await _setup(client)
    day = (await client.get("/api/journal/day", params={"date": "2025-03-05"})).json()
    assert day["summary"]["has_diary"] is True
    assert len(day["diary_entries"]) == 1 and day["diary_entries"][0]["body"] == "Текст"
    assert [e["title"] for e in day["events"]] == ["Обед"]


async def test_deleted_event_disappears_with_occurrences(client):
    lunch = await _setup(client)
    await push(client, change("event", lunch, op="delete", at="2030-01-01T00:00:00+00:00"))
    body = (await client.get("/api/journal/calendar", params={"month": "2025-03"})).json()
    assert sum(d["events_total"] for d in body["days"]) == 1   # остался только стоматолог


@pytest.mark.parametrize("month", ["2025-13", "2025-3", "abc", "1800-01"])
async def test_invalid_month(client, month):
    assert (await client.get("/api/journal/calendar", params={"month": month})).status_code == 422
