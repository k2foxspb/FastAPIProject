"""Серверные агрегаты финансов журнала."""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.journal import JournalFinanceCategory, JournalTransaction
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