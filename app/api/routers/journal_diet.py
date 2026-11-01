"""Диета «Журнала жизни»: поиск по личной базе продуктов и сводка питания за период."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_async_db
from app.core.auth import get_current_user
from app.models.users import User as UserModel
from app.schemas.journal.common import MAX_DATE, MIN_DATE
from app.schemas.journal.diet import DietSummaryResponse, FoodSearchResponse
from app.services.journal import nutrition

router = APIRouter(prefix="/api/journal", tags=["journal"])

MAX_SUMMARY_DAYS = 366


@router.get("/foods/search", response_model=FoodSearchResponse)
async def search_foods(
    q: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1, le=1000),
    limit: int = Query(default=30, ge=1, le=100),
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Свои продукты и рецепты: сначала частые и недавние; КБЖУ рецептов пересчитывается из ингредиентов."""
    return await nutrition.search_foods(db, current_user.id, q, page, limit)


@router.get("/diet/summary", response_model=DietSummaryResponse)
async def diet_summary(
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """КБЖУ и вода по дням периода, итог, среднее и цели пользователя."""
    if not (MIN_DATE <= date_from <= MAX_DATE and MIN_DATE <= date_to <= MAX_DATE):
        raise HTTPException(status_code=422, detail="Дата вне допустимого диапазона")
    if date_to < date_from:
        raise HTTPException(status_code=422, detail="Конец периода раньше начала")
    if (date_to - date_from).days + 1 > MAX_SUMMARY_DAYS:
        raise HTTPException(status_code=422, detail=f"Период не длиннее {MAX_SUMMARY_DAYS} дней")
    return await nutrition.diet_summary(db, current_user.id, date_from, date_to)
