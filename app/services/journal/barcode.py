"""Поиск продукта по штрихкоду в Open Food Facts с кэшем в БД и сохранением личной копии."""
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.journal import JournalBarcodeCache, JournalFood
from app.services.journal.sync_service import lock_state, next_rev

CACHE_TTL = timedelta(days=30)
OFF_URL = "https://world.openfoodfacts.org/api/v2/product/{barcode}.json"
OFF_TIMEOUT_SEC = 5.0
BARCODE_MIN_LEN = 8
BARCODE_MAX_LEN = 14


class BarcodeUnavailable(Exception):
    """Open Food Facts недоступен или ответил ошибкой: в кэш ничего не пишем."""


def normalize_barcode(code: str) -> str | None:
    digits = code.strip()
    if not digits.isdigit() or not (BARCODE_MIN_LEN <= len(digits) <= BARCODE_MAX_LEN):
        return None
    return digits


async def get_cached(db: AsyncSession, barcode: str) -> JournalBarcodeCache | None:
    row = (await db.execute(select(JournalBarcodeCache).where(
        JournalBarcodeCache.barcode == barcode,
    ))).scalar_one_or_none()
    if row is None:
        return None
    fetched_at = row.fetched_at if row.fetched_at.tzinfo else row.fetched_at.replace(tzinfo=timezone.utc)
    if fetched_at < datetime.now(timezone.utc) - CACHE_TTL:
        return None
    return row


async def fetch_open_food_facts(barcode: str) -> dict | None:
    """None - продукт не найден. Сетевые ошибки и неожиданные ответы - BarcodeUnavailable."""
    try:
        async with httpx.AsyncClient(timeout=OFF_TIMEOUT_SEC) as client:
            response = await client.get(OFF_URL.format(barcode=barcode))
    except httpx.HTTPError as exc:
        raise BarcodeUnavailable(str(exc)) from exc
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise BarcodeUnavailable(f"status {response.status_code}")
    try:
        data = response.json()
    except ValueError as exc:
        raise BarcodeUnavailable("invalid json") from exc
    if data.get("status") != 1:
        return None
    return data.get("product") or None


def _dec(value) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if result < 0 or result > 999999:
        return None
    return result.quantize(Decimal("0.01"))


def _serving_g(product: dict) -> Decimal | None:
    return _dec(product.get("serving_quantity"))


def product_to_cache(barcode: str, product: dict | None, now: datetime) -> JournalBarcodeCache:
    if product is None:
        return JournalBarcodeCache(barcode=barcode, found=False, fetched_at=now)
    nutriments = product.get("nutriments") or {}
    name = (product.get("product_name") or product.get("product_name_ru") or "").strip()[:200]
    brand = (product.get("brands") or "").split(",")[0].strip()[:100] or None
    return JournalBarcodeCache(
        barcode=barcode,
        found=bool(name),
        name=name or None,
        brand=brand,
        kcal_100=_dec(nutriments.get("energy-kcal_100g")),
        protein_100=_dec(nutriments.get("proteins_100g")),
        fat_100=_dec(nutriments.get("fat_100g")),
        carbs_100=_dec(nutriments.get("carbohydrates_100g")),
        serving_g=_serving_g(product),
        fetched_at=now,
    )


async def _store_cache(db: AsyncSession, row: JournalBarcodeCache) -> JournalBarcodeCache:
    existing = await db.get(JournalBarcodeCache, row.barcode)
    if existing is None:
        db.add(row)
        await db.flush()
        return row
    for column in ("found", "name", "brand", "kcal_100", "protein_100", "fat_100", "carbs_100",
                   "serving_g", "fetched_at"):
        setattr(existing, column, getattr(row, column))
    await db.flush()
    return existing


async def resolve_barcode(db: AsyncSession, user_id: int, barcode: str) -> JournalFood | None:
    """Личная копия продукта по штрихкоду. None - не найден ни в кэше, ни в Open Food Facts."""
    now = datetime.now(timezone.utc)
    cached = await get_cached(db, barcode)
    if cached is None:
        product = await fetch_open_food_facts(barcode)
        cached = await _store_cache(db, product_to_cache(barcode, product, now))
    if not cached.found:
        return None

    own = (await db.execute(select(JournalFood).where(
        JournalFood.user_id == user_id,
        JournalFood.barcode == barcode,
        JournalFood.deleted_at.is_(None),
    ))).scalars().first()
    if own is not None:
        return own

    state = await lock_state(db, user_id)
    food = JournalFood(
        user_id=user_id,
        client_uuid=str(uuid.uuid4()),
        name=cached.name,
        brand=cached.brand,
        kcal_100=cached.kcal_100 or Decimal(0),
        protein_100=cached.protein_100 or Decimal(0),
        fat_100=cached.fat_100 or Decimal(0),
        carbs_100=cached.carbs_100 or Decimal(0),
        serving_g=cached.serving_g,
        barcode=barcode,
        source="off",
        is_recipe=False,
        use_count=0,
        created_at=now,
        updated_at=now,
        server_rev=next_rev(state),
    )
    db.add(food)
    await db.flush()
    return food
