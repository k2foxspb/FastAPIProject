"""Аналитика и цели «Журнала жизни»: прогресс целей."""
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_async_db
from app.core.auth import get_current_user
from app.models.journal import JournalGoal, JournalTransaction
from app.models.users import User as UserModel
from app.schemas.journal.goals import GoalProgress
from app.services.journal import goals as goals_service
from app.services.journal.export import rows_to_csv

router = APIRouter(prefix="/api/journal", tags=["journal"])


@router.get("/goals/progress", response_model=list[GoalProgress])
async def goals_progress(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Прогресс всех активных целей пользователя по данным журнала."""
    today = datetime.now(timezone.utc).date()
    goals = (await db.execute(select(JournalGoal).where(
        JournalGoal.user_id == current_user.id,
        JournalGoal.deleted_at.is_(None),
        JournalGoal.status == "active",
    ).order_by(JournalGoal.start_date))).scalars().all()
    return [await goals_service.goal_progress(db, current_user.id, goal, today) for goal in goals]


@router.get("/export/transactions.csv")
async def export_transactions_csv(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Операции пользователя за период в CSV (сумма в рублях)."""
    query = select(JournalTransaction).where(
        JournalTransaction.user_id == current_user.id,
        JournalTransaction.deleted_at.is_(None),
    )
    if date_from is not None:
        query = query.where(JournalTransaction.transaction_date >= date_from)
    if date_to is not None:
        query = query.where(JournalTransaction.transaction_date <= date_to)
    transactions = (await db.execute(query.order_by(
        JournalTransaction.transaction_date, JournalTransaction.id
    ))).scalars().all()
    header = ["date", "direction", "amount", "description", "merchant", "note"]
    rows = [
        [
            item.transaction_date.isoformat(),
            item.direction,
            Decimal(item.amount_kop).scaleb(-2),
            item.description,
            item.merchant,
            item.note,
        ]
        for item in transactions
    ]
    return Response(
        content=rows_to_csv(header, rows),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="transactions.csv"'},
    )
