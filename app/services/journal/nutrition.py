"""
Питание: расчёт КБЖУ (порции и рецепты), дневные итоги и поиск по личной базе.

Итоги всегда считаются SQL-агрегатами по записям о еде и воде (клиентским
суммам не доверяем). КБЖУ - не деньги, поэтому здесь Decimal с округлением
до сотых, а в ответах - float.
"""
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.journal import JournalFood, JournalFoodEntry, JournalRecipeItem, JournalSettings, JournalWaterEntry
from app.schemas.journal.diet import DietDayTotals, DietGoals, DietSummaryResponse, FoodOut, FoodSearchResponse

NUTRIENTS = ("kcal", "protein", "fat", "carbs")
_CENT = Decimal("0.01")
_HUNDRED = Decimal(100)


def _d(value) -> Decimal:
    if value is None:
        return Decimal(0)
    return value if isinstance(value, Decimal) else Decimal(str(value))


def round2(value) -> Decimal:
    return _d(value).quantize(_CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Per100:
    kcal: Decimal
    protein: Decimal
    fat: Decimal
    carbs: Decimal


def per100_of(food) -> Per100:
    return Per100(_d(food.kcal_100), _d(food.protein_100), _d(food.fat_100), _d(food.carbs_100))


def portion(per100: Per100, grams) -> dict[str, Decimal]:
    """КБЖУ порции весом grams из значений на 100 г."""
    k = _d(grams) / _HUNDRED
    return {name: round2(getattr(per100, name) * k) for name in NUTRIENTS}


def recipe_per100(ingredients: Iterable[tuple[Per100, Decimal]], yield_g=None) -> tuple[Per100, Decimal]:
    """
    КБЖУ рецепта на 100 г готового блюда.

    ingredients - пары (КБЖУ ингредиента на 100 г, вес ингредиента в г).
    yield_g - вес готового блюда (уварка/ужарка); если не задан - сумма весов.
    Возвращает (КБЖУ на 100 г, вес блюда).
    """
    totals = {name: Decimal(0) for name in NUTRIENTS}
    raw_weight = Decimal(0)
    for per100, grams in ingredients:
        grams = _d(grams)
        if grams <= 0:
            continue
        raw_weight += grams
        for name in NUTRIENTS:
            totals[name] += getattr(per100, name) * grams / _HUNDRED
    weight = _d(yield_g) if yield_g and _d(yield_g) > 0 else raw_weight
    if weight <= 0:
        zero = Decimal("0.00")
        return Per100(zero, zero, zero, zero), Decimal(0)
    k = _HUNDRED / weight
    return Per100(*(round2(totals[name] * k) for name in NUTRIENTS)), round2(weight)


async def recipe_per100_for(db: AsyncSession, user_id: int, recipes: list) -> dict[int, Per100]:
    """Пересчитывает КБЖУ рецептов пользователя из их ингредиентов (по id рецепта)."""
    if not recipes:
        return {}
    rows = (await db.execute(
        select(JournalRecipeItem.recipe_id, JournalRecipeItem.grams, JournalFood)
        .join(JournalFood, JournalFood.id == JournalRecipeItem.ingredient_id)
        .where(
            JournalRecipeItem.user_id == user_id,
            JournalRecipeItem.deleted_at.is_(None),
            JournalFood.deleted_at.is_(None),
            JournalRecipeItem.recipe_id.in_([r.id for r in recipes]),
        )
    )).all()
    items: dict[int, list[tuple[Per100, Decimal]]] = defaultdict(list)
    for recipe_id, grams, ingredient in rows:
        items[recipe_id].append((per100_of(ingredient), _d(grams)))
    result: dict[int, Per100] = {}
    for recipe in recipes:
        if items.get(recipe.id):
            result[recipe.id] = recipe_per100(items[recipe.id], recipe.recipe_yield_g)[0]
    return result


# ---------------------------------------------------------------- итоги

async def kcal_by_day(db: AsyncSession, user_id: int, start: date, end: date) -> dict[date, dict[str, int]]:
    """Провайдер итогов календаря: ккал по дням (DAY_TOTAL_PROVIDERS)."""
    rows = (await db.execute(
        select(JournalFoodEntry.entry_date, func.sum(JournalFoodEntry.kcal))
        .where(
            JournalFoodEntry.user_id == user_id,
            JournalFoodEntry.deleted_at.is_(None),
            JournalFoodEntry.entry_date.between(start, end),
        )
        .group_by(JournalFoodEntry.entry_date)
    )).all()
    return {d: {"kcal": int(round2(total).to_integral_value(rounding=ROUND_HALF_UP))} for d, total in rows if total}


async def diet_summary(db: AsyncSession, user_id: int, start: date, end: date) -> DietSummaryResponse:
    food_rows = (await db.execute(
        select(
            JournalFoodEntry.entry_date,
            func.sum(JournalFoodEntry.kcal), func.sum(JournalFoodEntry.protein),
            func.sum(JournalFoodEntry.fat), func.sum(JournalFoodEntry.carbs),
            func.count(JournalFoodEntry.id),
        )
        .where(
            JournalFoodEntry.user_id == user_id,
            JournalFoodEntry.deleted_at.is_(None),
            JournalFoodEntry.entry_date.between(start, end),
        )
        .group_by(JournalFoodEntry.entry_date)
    )).all()
    water_rows = (await db.execute(
        select(JournalWaterEntry.entry_date, func.sum(JournalWaterEntry.amount_ml))
        .where(
            JournalWaterEntry.user_id == user_id,
            JournalWaterEntry.deleted_at.is_(None),
            JournalWaterEntry.entry_date.between(start, end),
        )
        .group_by(JournalWaterEntry.entry_date)
    )).all()

    days: dict[date, DietDayTotals] = {}
    day = start
    while day <= end:
        days[day] = DietDayTotals(date=day)
        day += timedelta(days=1)
    for d, kcal, protein, fat, carbs, count in food_rows:
        item = days[d]
        item.kcal, item.protein = float(round2(kcal)), float(round2(protein))
        item.fat, item.carbs = float(round2(fat)), float(round2(carbs))
        item.entries = int(count)
    for d, ml in water_rows:
        days[d].water_ml = int(ml or 0)

    ordered = [days[d] for d in sorted(days)]
    total = DietDayTotals(date=end)
    for item in ordered:
        for name in NUTRIENTS:
            setattr(total, name, getattr(total, name) + getattr(item, name))
        total.water_ml += item.water_ml
        total.entries += item.entries
    for name in NUTRIENTS:
        setattr(total, name, float(round2(getattr(total, name))))

    # Среднее - по дням, в которые что-то записано (пустые дни не занижают среднее)
    filled = [i for i in ordered if i.entries or i.water_ml] or ordered
    n = len(filled)
    average = DietDayTotals(date=end)
    for name in NUTRIENTS:
        setattr(average, name, float(round2(sum(getattr(i, name) for i in filled) / n)))
    average.water_ml = round(sum(i.water_ml for i in filled) / n)
    average.entries = round(sum(i.entries for i in filled) / n)

    settings = (await db.execute(
        select(JournalSettings).where(JournalSettings.user_id == user_id, JournalSettings.deleted_at.is_(None))
    )).scalar_one_or_none()
    goals = DietGoals()
    if settings is not None:
        goals = DietGoals(
            kcal=settings.kcal_goal, protein=settings.protein_g_goal, fat=settings.fat_g_goal,
            carbs=settings.carbs_g_goal, water_ml=settings.water_ml_goal,
        )
    return DietSummaryResponse(date_from=start, date_to=end, days=ordered, total=total, average=average, goals=goals)


# ---------------------------------------------------------------- поиск по личной базе

def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def search_foods(db: AsyncSession, user_id: int, q: str | None, page: int, limit: int) -> FoodSearchResponse:
    """Поиск по своей базе: сначала частые и недавние. Для рецептов КБЖУ пересчитывается из ингредиентов."""
    stmt = select(JournalFood).where(JournalFood.user_id == user_id, JournalFood.deleted_at.is_(None))
    q = (q or "").strip()
    if q:
        # lower() в SQLite не понимает кириллицу, поэтому дополнительно сравниваем с типичными
        # вариантами регистра запроса (в PostgreSQL достаточно первого условия)
        conditions = [JournalFood.barcode == q]
        for column in (JournalFood.name, JournalFood.brand):
            conditions.append(func.lower(column).like(f"%{_escape_like(q.lower())}%", escape="\\"))
            for variant in {q, q.lower(), q.capitalize(), q.upper()}:
                conditions.append(column.like(f"%{_escape_like(variant)}%", escape="\\"))
        stmt = stmt.where(or_(*conditions))
    stmt = stmt.order_by(
        JournalFood.use_count.desc(), JournalFood.last_used_at.desc().nulls_last(), JournalFood.name, JournalFood.id,
    ).offset((page - 1) * limit).limit(limit + 1)
    rows = (await db.execute(stmt)).scalars().all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    recipes = await recipe_per100_for(db, user_id, [r for r in rows if r.is_recipe])

    items = []
    for row in rows:
        per100 = recipes.get(row.id) or per100_of(row)
        items.append(FoodOut(
            client_uuid=row.client_uuid,
            name=row.name,
            brand=row.brand,
            kcal_100=float(per100.kcal),
            protein_100=float(per100.protein),
            fat_100=float(per100.fat),
            carbs_100=float(per100.carbs),
            serving_g=float(row.serving_g) if row.serving_g is not None else None,
            barcode=row.barcode,
            source=row.source,
            is_recipe=row.is_recipe,
            use_count=row.use_count,
            last_used_at=row.last_used_at,
        ))
    return FoodSearchResponse(items=items, page=page, has_more=has_more)
