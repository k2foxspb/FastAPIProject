"""Диета «Журнала жизни»: поиск по личной базе продуктов и сводка питания за период."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_async_db
from app.core.auth import get_current_user
from app.models.users import User as UserModel
from app.schemas.journal.common import MAX_DATE, MIN_DATE
from app.schemas.journal.diet import DietSummaryResponse, FoodOut, FoodSearchResponse
from app.services.journal import nutrition
from app.services.journal.barcode import BarcodeUnavailable, normalize_barcode, resolve_barcode

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


@router.get("/barcode/{code}", response_model=FoodOut)
async def barcode_lookup(
    code: str,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Продукт по штрихкоду: кэш, Open Food Facts; найденный продукт сохраняется в личную базу."""
    barcode = normalize_barcode(code)
    if barcode is None:
        raise HTTPException(status_code=422, detail="Некорректный штрихкод")
    try:
        food = await resolve_barcode(db, current_user.id, barcode)
    except BarcodeUnavailable:
        raise HTTPException(status_code=502, detail="Сервис продуктов временно недоступен")
    if food is None:
        raise HTTPException(status_code=404, detail="Продукт не найден")
    await db.commit()
    return FoodOut(
        client_uuid=food.client_uuid,
        name=food.name,
        brand=food.brand,
        kcal_100=float(food.kcal_100),
        protein_100=float(food.protein_100),
        fat_100=float(food.fat_100),
        carbs_100=float(food.carbs_100),
        serving_g=float(food.serving_g) if food.serving_g is not None else None,
        barcode=food.barcode,
        source=food.source,
        is_recipe=food.is_recipe,
        use_count=food.use_count,
        last_used_at=food.last_used_at,
    )


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
