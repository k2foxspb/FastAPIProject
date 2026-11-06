"""Аналитика и проверка операций."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_async_db
from app.core.auth import get_current_user
from app.models.users import User as UserModel
from app.schemas.journal.common import MAX_DATE, MIN_DATE
from app.schemas.journal.finance import FinanceSummary
from app.services.journal import finance

router = APIRouter(prefix="/api/journal", tags=["journal"])




@router.get("/finance/analytics", response_model=FinanceSummary)
async def finance_analytics(
    date_from: date = Query(..., alias="from"), date_to: date = Query(..., alias="to"),
    current_user: UserModel = Depends(get_current_user), db: AsyncSession = Depends(get_async_db),
):
    if not (MIN_DATE <= date_from <= MAX_DATE and MIN_DATE <= date_to <= MAX_DATE):
        raise HTTPException(status_code=422, detail="Дата вне допустимого диапазона")
    if date_to < date_from or (date_to - date_from).days > 366:
        raise HTTPException(status_code=422, detail="Период должен быть от 1 до 367 дней")
    return await finance.finance_summary(db, current_user.id, date_from, date_to)


@router.get("/finance/review")
async def finance_review(
    limit: int = Query(default=100, ge=1, le=500),
    current_user: UserModel = Depends(get_current_user), db: AsyncSession = Depends(get_async_db),
):
    return await finance.review_queue(db, current_user.id, limit)
