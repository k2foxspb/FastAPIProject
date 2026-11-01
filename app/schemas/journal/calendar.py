"""Схемы календаря журнала (агрегаты месяца и экран дня)."""
import datetime as dt
from typing import Any

from pydantic import BaseModel


class CalendarDay(BaseModel):
    date: dt.date
    kcal: int = 0
    expense_kop: int = 0
    has_diary: bool = False
    events_total: int = 0
    events_done: int = 0


class CalendarMonthResponse(BaseModel):
    month: str
    days: list[CalendarDay]


class EventInstanceOut(BaseModel):
    event_uuid: str
    original_date: dt.date
    date: dt.date
    time: dt.time | None = None
    status: str
    title: str
    kind: str
    occurrence_uuid: str | None = None
    recurring: bool = False


class DayResponse(BaseModel):
    date: dt.date
    summary: CalendarDay
    events: list[EventInstanceOut]
    diary_entries: list[dict[str, Any]]
    tracker_values: list[dict[str, Any]]
    food_entries: list[dict[str, Any]] = []
    water_ml: int = 0
