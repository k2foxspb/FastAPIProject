"""Серверные агрегаты финансов журнала."""
import calendar
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.journal import JournalBudget, JournalFinanceCategory, JournalTransaction
from app.schemas.journal.finance import CategoryTotal, FinanceSummary, ReviewQueueResponse


async def expense_by_day(db: AsyncSession, user_id: int, start: date, end: date) -> dict[date, dict[str, int]]:
    rows = (await db.execute(
        select(JournalTransaction.transaction_date, func.sum(JournalTransaction.amount_kop))
        .where(
            JournalTransaction.user_id == user_id,
            JournalTransaction.deleted_at.is_(None),
            JournalTransaction.direction == "expense",
            JournalTransaction.transaction_date.between(start, end),
        ).group_by(JournalTransaction.transaction_date)
    )).all()
    return {day: {"expense_kop": int(total or 0)} for day, total in rows}


async def finance_summary(db: AsyncSession, user_id: int, start: date, end: date) -> FinanceSummary:
    transactions = (await db.execute(select(
        JournalTransaction.direction, JournalTransaction.amount_kop, JournalTransaction.category_id,
        JournalFinanceCategory.client_uuid, JournalFinanceCategory.name, JournalTransaction.transaction_date,
    ).outerjoin(JournalFinanceCategory, JournalFinanceCategory.id == JournalTransaction.category_id).where(
        JournalTransaction.user_id == user_id, JournalTransaction.deleted_at.is_(None),
        JournalTransaction.transaction_date.between(start, end),
    ))).all()
    income = sum(int(row.amount_kop) for row in transactions if row.direction == "income")
    expense = sum(int(row.amount_kop) for row in transactions if row.direction == "expense")
    categories: dict[tuple[str | None, str], list[int]] = {}
    months: dict[str, dict[str, int]] = {}
    for row in transactions:
        if row.direction == "expense":
            key = (row.client_uuid, row.name or "Без категории")
            values = categories.setdefault(key, [0, 0])
            values[0] += int(row.amount_kop)
            values[1] += 1
        month = row.transaction_date.strftime("%Y-%m")
        totals = months.setdefault(month, {"income_kop": 0, "expense_kop": 0})
        totals[f"{row.direction}_kop"] += int(row.amount_kop)

    return FinanceSummary(
        date_from=start, date_to=end, income_kop=income, expense_kop=expense, net_kop=income - expense,
        by_category=[CategoryTotal(category_uuid=uuid, category_name=name, amount_kop=values[0], transactions=values[1])
                     for (uuid, name), values in sorted(categories.items(), key=lambda item: -item[1][0])],
        by_month=[{"month": month, **totals} for month, totals in sorted(months.items())],
    )


async def review_queue(db: AsyncSession, user_id: int, limit: int = 100) -> ReviewQueueResponse:
    rows = (await db.execute(select(JournalTransaction, JournalFinanceCategory.name).outerjoin(
        JournalFinanceCategory, JournalFinanceCategory.id == JournalTransaction.category_id
    ).where(
        JournalTransaction.user_id == user_id, JournalTransaction.deleted_at.is_(None),
        JournalTransaction.review_required.is_(True),
    ).order_by(JournalTransaction.transaction_date.desc(), JournalTransaction.created_at.desc()).limit(limit))).all()
    items = [{
        "uuid": transaction.client_uuid, "transaction_date": transaction.transaction_date,
        "direction": transaction.direction, "amount_kop": transaction.amount_kop,
        "description": transaction.description, "merchant": transaction.merchant,
        "category_name": category_name,
    } for transaction, category_name in rows]
    total = await db.scalar(select(func.count(JournalTransaction.id)).where(
        JournalTransaction.user_id == user_id, JournalTransaction.deleted_at.is_(None),
        JournalTransaction.review_required.is_(True),
    )) or 0
    return ReviewQueueResponse(items=items, total=int(total))


async def budget_status(db: AsyncSession, user_id: int, period_month: str) -> list[dict]:
    year, month = map(int, period_month.split("-"))
    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    budgets = (await db.execute(select(JournalBudget, JournalFinanceCategory.name).outerjoin(
        JournalFinanceCategory, JournalFinanceCategory.id == JournalBudget.category_id
    ).where(
        JournalBudget.user_id == user_id, JournalBudget.deleted_at.is_(None),
        JournalBudget.enabled.is_(True), JournalBudget.period_month == period_month,
    ))).all()
    results = []
    for budget, category_name in budgets:
        query = select(func.coalesce(func.sum(JournalTransaction.amount_kop), 0)).where(
            JournalTransaction.user_id == user_id, JournalTransaction.deleted_at.is_(None),
            JournalTransaction.direction == "expense", JournalTransaction.transaction_date.between(start, end),
        )
        if budget.category_id is not None:
            query = query.where(JournalTransaction.category_id == budget.category_id)
        spent = int((await db.scalar(query)) or 0)
        results.append({
            "uuid": budget.client_uuid, "category_name": category_name or "Все расходы",
            "period_month": period_month, "limit_kop": budget.limit_kop, "spent_kop": spent,
            "percent": min(1000, round(spent * 100 / budget.limit_kop, 1)),
        })
    return results