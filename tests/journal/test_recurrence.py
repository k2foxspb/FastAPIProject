"""Правила повторения журнала: разбор RRULE, развёртывание дат, таймзоны, исключения."""
import json
from datetime import date, time
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services.journal.recurrence import (
    expand_event, format_rrule, iter_dates, local_to_utc, parse_rrule,
)

VECTORS = json.loads((Path(__file__).parent.parent / "fixtures" / "recurrence_vectors.json").read_text("utf-8"))


def _d(value: str) -> date:
    return date.fromisoformat(value)


@pytest.mark.parametrize("vector", VECTORS["expand"], ids=lambda v: v["name"])
def test_expand_vectors(vector):
    result = iter_dates(
        vector["rrule"], _d(vector["dtstart"]), _d(vector["range"][0]), _d(vector["range"][1]),
        _d(vector["until"]) if vector.get("until") else None,
    )
    assert [d.isoformat() for d in result] == vector["expected"]


@pytest.mark.parametrize("vector", VECTORS["to_utc"], ids=lambda v: v["name"])
def test_to_utc_vectors(vector):
    result = local_to_utc(_d(vector["date"]), time.fromisoformat(vector["time"]), vector["tz"])
    assert result.isoformat() == vector["expected"]


@pytest.mark.parametrize("rule", [
    "FREQ=YEARLY",
    "FREQ=DAILY;COUNT=5",
    "FREQ=DAILY;BYDAY=MO",
    "FREQ=WEEKLY;BYDAY=XX",
    "FREQ=WEEKLY;BYMONTHDAY=3",
    "FREQ=MONTHLY;BYMONTHDAY=32",
    "FREQ=DAILY;INTERVAL=0",
    "FREQ=DAILY;FREQ=WEEKLY",
    "FREQ=DAILY;UNTIL=2025-01-01",
    "",
])
def test_invalid_rules_rejected(rule):
    with pytest.raises(ValueError):
        parse_rrule(rule)


def test_format_is_canonical():
    rule = parse_rrule("RRULE:freq=weekly;byday=fr,mo;interval=2;until=20251231T235959Z")
    assert format_rrule(rule) == "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;UNTIL=20251231"


def _event(**kw):
    defaults = dict(client_uuid="ev", rrule="FREQ=DAILY", start_date=date(2025, 3, 1), start_time=time(13, 0),
                    until_date=None, status="planned", title="Обед", kind="meal")
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _occ(orig, status="planned", moved_date=None, moved_time=None):
    return SimpleNamespace(occurrence_date=orig, status=status, moved_date=moved_date,
                           moved_time=moved_time, client_uuid=f"occ-{orig}")


def test_expand_event_with_overrides():
    overrides = {
        date(2025, 3, 2): _occ(date(2025, 3, 2), status="done"),
        date(2025, 3, 3): _occ(date(2025, 3, 3), status="cancelled"),
        # 4-е число перенесено на 10-е (за пределы диапазона) - в диапазоне его нет
        date(2025, 3, 4): _occ(date(2025, 3, 4), moved_date=date(2025, 3, 10)),
    }
    result = expand_event(_event(), overrides, date(2025, 3, 1), date(2025, 3, 5))
    assert [(i.date.day, i.status) for i in result] == [(1, "planned"), (2, "done"), (5, "planned")]
    assert result[1].occurrence_uuid == "occ-2025-03-02"


def test_expand_event_moved_into_range_from_outside():
    overrides = {date(2025, 2, 28): _occ(date(2025, 2, 28), moved_date=date(2025, 3, 2), moved_time=time(9, 30))}
    event = _event(start_date=date(2025, 2, 1))
    result = expand_event(event, overrides, date(2025, 3, 2), date(2025, 3, 2))
    assert [(i.original_date, i.date, i.time) for i in result] == [
        (date(2025, 2, 28), date(2025, 3, 2), time(9, 30)),
        (date(2025, 3, 2), date(2025, 3, 2), time(13, 0)),
    ]


def test_expand_one_off_event_uses_own_status():
    event = _event(rrule=None, status="done", start_date=date(2025, 3, 3))
    assert [(i.date, i.status, i.recurring) for i in expand_event(event, {}, date(2025, 3, 1), date(2025, 3, 31))] == [
        (date(2025, 3, 3), "done", False)
    ]
    assert expand_event(event, {}, date(2025, 4, 1), date(2025, 4, 30)) == []
