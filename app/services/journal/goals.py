"""
Прогресс целей журнала (фаза 4). Значение считается из данных при каждом запросе:
трекер, вес, вода, КБЖУ из дневника питания.
"""
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.journal import (
    JournalFinanceCategory, JournalFoodEntry, JournalGoal, JournalTracker, JournalTrackerValue,
    JournalTransaction, JournalWaterEntry,
)
from app.schemas.journal.goals import GoalProgress

TRACKER_TYPES = {"tracker", "weight"}
FOOD_FIELDS = {"kcal": "kcal", "protein": "protein", "fat": "fat", "carbs": "carbs"}


def period_bounds(goal: JournalGoal, today: date) -> tuple[date, date]:
    """Окно, за которое считается прогресс: сутки, неделя (ISO) или месяц, либо весь срок цели."""
    if goal.period == "day":
        return today, today
    if goal.period == "week":
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=6)
    if goal.period == "month":
        start = today.replace(day=1)
        nxt = (start + timedelta(days=32)).replace(day=1)
        return start, nxt - timedelta(days=1)
    end = goal.deadline or today
    return goal.start_date, end


async def _sum_food(db: AsyncSession, user_id: int, field: str, start: date, end: date) -> Decimal:
    column = getattr(JournalFoodEntry, field)
    value = (await db.execute(select(func.coalesce(func.sum(column), 0)).where(
        JournalFoodEntry.user_id == user_id,
        JournalFoodEntry.deleted_at.is_(None),
        JournalFoodEntry.entry_date >= start,
        JournalFoodEntry.entry_date <= end,
    ))).scalar_one()
    return Decimal(value)


async def _sum_water(db: AsyncSession, user_id: int, start: date, end: date) -> Decimal:
    value = (await db.execute(select(func.coalesce(func.sum(JournalWaterEntry.amount_ml), 0)).where(
        JournalWaterEntry.user_id == user_id,
        JournalWaterEntry.deleted_at.is_(None),
        JournalWaterEntry.entry_date >= start,
        JournalWaterEntry.entry_date <= end,
    ))).scalar_one()
    return Decimal(value)


async def _tracker_value(db: AsyncSession, user_id: int, tracker_uuid: str | None,
                         start: date, end: date, latest: bool) -> Decimal | None:
    """latest=True - последнее значение за окно (вес), иначе сумма (счётчики)."""
    if tracker_uuid is None:
        return None
    tracker = (await db.execute(select(JournalTracker).where(
        JournalTracker.user_id == user_id,
        JournalTracker.client_uuid == tracker_uuid,
        JournalTracker.deleted_at.is_(None),
    ))).scalar_one_or_none()
    if tracker is None:
        return None
    base = [
        JournalTrackerValue.user_id == user_id,
        JournalTrackerValue.tracker_id == tracker.id,
        JournalTrackerValue.deleted_at.is_(None),
        JournalTrackerValue.value_date >= start,
        JournalTrackerValue.value_date <= end,
    ]
    if latest:
        row = (await db.execute(select(JournalTrackerValue.num_value).where(*base).order_by(
            JournalTrackerValue.value_date.desc(), JournalTrackerValue.value_time.desc(),
        ).limit(1))).first()
        return None if row is None or row[0] is None else Decimal(row[0])
    value = (await db.execute(select(func.coalesce(func.sum(JournalTrackerValue.num_value), 0)).where(*base))).scalar_one()
    return Decimal(value)


async def _expense_total(db: AsyncSession, user_id: int, category_uuid: str | None,
                         start: date, end: date) -> Decimal:
    stmt = select(func.coalesce(func.sum(JournalTransaction.amount_kop), 0)).where(
        JournalTransaction.user_id == user_id,
        JournalTransaction.deleted_at.is_(None),
        JournalTransaction.direction == "expense",
        JournalTransaction.transaction_date >= start,
        JournalTransaction.transaction_date <= end,
    )
    if category_uuid is not None:
        category = (await db.execute(select(JournalFinanceCategory.id).where(
            JournalFinanceCategory.user_id == user_id,
            JournalFinanceCategory.client_uuid == category_uuid,
            JournalFinanceCategory.deleted_at.is_(None),
        ))).scalar_one_or_none()
        if category is None:
            return Decimal(0)
        stmt = stmt.where(JournalTransaction.category_id == category)
    return Decimal((await db.execute(stmt)).scalar_one()) / Decimal(100)


async def current_value(db: AsyncSession, user_id: int, goal: JournalGoal, today: date) -> tuple[Decimal | None, date, date]:
    start, end = period_bounds(goal, today)
    kind = goal.source_type
    if kind in TRACKER_TYPES:
        value = await _tracker_value(db, user_id, goal.source_uuid, start, end, latest=(kind == "weight"))
    elif kind == "water":
        value = await _sum_water(db, user_id, start, end)
    elif kind in FOOD_FIELDS:
        value = await _sum_food(db, user_id, FOOD_FIELDS[kind], start, end)
    elif kind == "expense_total":
        value = await _expense_total(db, user_id, None, start, end)
    elif kind == "expense_category":
        value = await _expense_total(db, user_id, goal.source_uuid, start, end)
    else:
        value = None
    return value, start, end


def evaluate(goal: JournalGoal, current: Decimal | None) -> tuple[float, float, bool]:
    """Процент выполнения и признак достижения. not_exceed: достигнуто, если не превышен лимит."""
    target = float(goal.target_value)
    cur = float(current) if current is not None else 0.0
    if target <= 0:
        percent = 100.0 if (goal.direction == "not_exceed" or cur >= target) else 0.0
    else:
        percent = round(min(cur / target * 100, 1000.0), 1)
    if goal.direction == "not_exceed":
        achieved = cur <= target
    else:
        achieved = cur >= target
    return percent, cur, achieved


async def goal_progress(db: AsyncSession, user_id: int, goal: JournalGoal, today: date) -> GoalProgress:
    value, start, end = await current_value(db, user_id, goal, today)
    percent, cur, achieved = evaluate(goal, value)
    return GoalProgress(
        goal_uuid=goal.client_uuid,
        title=goal.title,
        source_type=goal.source_type,
        current=cur,
        target=float(goal.target_value),
        percent=percent,
        achieved=achieved,
        period_start=start,
        period_end=end,
    )
