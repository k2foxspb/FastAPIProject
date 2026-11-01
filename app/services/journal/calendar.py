"""
Агрегаты календаря журнала. Итоги всегда пересчитываются на сервере из
записей (клиентским агрегатам не доверяем).

Последующие фазы добавляют свои итоги дня (ккал - диета, расход - финансы)
через DAY_TOTAL_PROVIDERS: async (db, user_id, start, end) -> {date: {поле: значение}}.
"""
import calendar as std_calendar
from collections import defaultdict
from datetime import date
from typing import Awaitable, Callable

from loguru import logger
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.journal import (
    JournalDiaryEntry, JournalEvent, JournalEventOccurrence, JournalFoodEntry, JournalTrackerValue, JournalWaterEntry,
)
from app.schemas.journal.calendar import CalendarDay, CalendarMonthResponse, DayResponse, EventInstanceOut
from app.services.journal import nutrition
from app.services.journal.finance import expense_by_day
from app.services.journal.recurrence import EventInstance, expand_event
from app.services.journal.sync_registry import REGISTRY
from app.services.journal.sync_service import serialize_rows

DayTotalsProvider = Callable[[AsyncSession, int, date, date], Awaitable[dict[date, dict[str, int]]]]
DAY_TOTAL_PROVIDERS: list[DayTotalsProvider] = [
    nutrition.kcal_by_day,  # фаза 2: ккал из записей о еде
    expense_by_day,  # фаза 3: расходы без переводов
]


def month_bounds(year: int, month: int) -> tuple[date, date]:
    last = std_calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


async def events_in_range(db: AsyncSession, user_id: int, start: date, end: date) -> list[EventInstance]:
    """Экземпляры событий пользователя в диапазоне с учётом повторений и исключений."""
    moved_into_range = select(JournalEventOccurrence.event_id).where(
        JournalEventOccurrence.user_id == user_id,
        JournalEventOccurrence.deleted_at.is_(None),
        JournalEventOccurrence.moved_date.between(start, end),
    )
    events = (await db.execute(
        select(JournalEvent).where(
            JournalEvent.user_id == user_id,
            JournalEvent.deleted_at.is_(None),
            or_(
                and_(
                    JournalEvent.start_date <= end,
                    or_(
                        and_(JournalEvent.rrule.is_(None), JournalEvent.start_date >= start),
                        and_(
                            JournalEvent.rrule.is_not(None),
                            or_(JournalEvent.until_date.is_(None), JournalEvent.until_date >= start),
                        ),
                    ),
                ),
                JournalEvent.id.in_(moved_into_range),
            ),
        )
    )).scalars().all()
    if not events:
        return []

    overrides: dict[int, dict[date, JournalEventOccurrence]] = defaultdict(dict)
    occurrences = (await db.execute(
        select(JournalEventOccurrence).where(
            JournalEventOccurrence.user_id == user_id,
            JournalEventOccurrence.deleted_at.is_(None),
            JournalEventOccurrence.event_id.in_([e.id for e in events]),
            or_(
                JournalEventOccurrence.occurrence_date.between(start, end),
                JournalEventOccurrence.moved_date.between(start, end),
            ),
        )
    )).scalars().all()
    for occ in occurrences:
        overrides[occ.event_id][occ.occurrence_date] = occ

    instances: list[EventInstance] = []
    for event in events:
        try:
            instances.extend(expand_event(event, overrides.get(event.id, {}), start, end))
        except ValueError:
            # Правило провалидировано при записи; сюда попадают только старые/битые данные
            logger.warning(f"Journal: некорректное правило повторения у события id={event.id}")
    return instances


async def summarize_range(db: AsyncSession, user_id: int, start: date, end: date) -> dict[date, CalendarDay]:
    days: dict[date, CalendarDay] = {}
    day = start
    while day <= end:
        days[day] = CalendarDay(date=day)
        day = date.fromordinal(day.toordinal() + 1)

    diary_dates = (await db.execute(
        select(JournalDiaryEntry.entry_date).where(
            JournalDiaryEntry.user_id == user_id,
            JournalDiaryEntry.deleted_at.is_(None),
            JournalDiaryEntry.entry_date.between(start, end),
        ).distinct()
    )).scalars().all()
    for d in diary_dates:
        if d in days:
            days[d].has_diary = True

    for inst in await events_in_range(db, user_id, start, end):
        summary = days.get(inst.date)
        if summary is None:
            continue
        summary.events_total += 1
        if inst.status == "done":
            summary.events_done += 1

    for provider in DAY_TOTAL_PROVIDERS:
        for d, totals in (await provider(db, user_id, start, end)).items():
            if d in days:
                for key, value in totals.items():
                    setattr(days[d], key, getattr(days[d], key) + int(value))
    return days


async def month_summary(db: AsyncSession, user_id: int, year: int, month: int) -> CalendarMonthResponse:
    start, end = month_bounds(year, month)
    days = await summarize_range(db, user_id, start, end)
    return CalendarMonthResponse(month=f"{year:04d}-{month:02d}", days=[days[d] for d in sorted(days)])


async def day_details(db: AsyncSession, user_id: int, day: date) -> DayResponse:
    summary = (await summarize_range(db, user_id, day, day))[day]
    instances = await events_in_range(db, user_id, day, day)

    diary_rows = (await db.execute(
        select(JournalDiaryEntry).where(
            JournalDiaryEntry.user_id == user_id,
            JournalDiaryEntry.deleted_at.is_(None),
            JournalDiaryEntry.entry_date == day,
        ).order_by(JournalDiaryEntry.entry_time, JournalDiaryEntry.id)
    )).scalars().all()
    value_rows = (await db.execute(
        select(JournalTrackerValue).where(
            JournalTrackerValue.user_id == user_id,
            JournalTrackerValue.deleted_at.is_(None),
            JournalTrackerValue.value_date == day,
        ).order_by(JournalTrackerValue.value_time, JournalTrackerValue.id)
    )).scalars().all()

    diary = await serialize_rows(db, REGISTRY["diary_entry"], diary_rows)
    for row, data in zip(diary_rows, diary):
        data["client_uuid"] = row.client_uuid
    values = await serialize_rows(db, REGISTRY["tracker_value"], value_rows)
    for row, data in zip(value_rows, values):
        data["client_uuid"] = row.client_uuid

    food_rows = (await db.execute(
        select(JournalFoodEntry).where(
            JournalFoodEntry.user_id == user_id,
            JournalFoodEntry.deleted_at.is_(None),
            JournalFoodEntry.entry_date == day,
        ).order_by(JournalFoodEntry.entry_time, JournalFoodEntry.id)
    )).scalars().all()
    food = await serialize_rows(db, REGISTRY["food_entry"], food_rows)
    for row, data in zip(food_rows, food):
        data["client_uuid"] = row.client_uuid
    water_rows = (await db.execute(
        select(JournalWaterEntry).where(
            JournalWaterEntry.user_id == user_id,
            JournalWaterEntry.deleted_at.is_(None),
            JournalWaterEntry.entry_date == day,
        )
    )).scalars().all()

    return DayResponse(
        date=day,
        summary=summary,
        events=[EventInstanceOut(**inst.__dict__) for inst in instances],
        diary_entries=diary,
        tracker_values=values,
        food_entries=food,
        water_ml=sum(row.amount_ml for row in water_rows),
    )
