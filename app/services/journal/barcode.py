"""Поиск продукта по штрихкоду в Open Food Facts с кэшем в БД."""
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.journal import JournalBarcodeCache

CACHE_TTL = timedelta(days=30)
OFF_URL = "https://world.openfoodfacts.org/api/v2/product/{barcode}.json"
OFF_TIMEOUT_SEC = 5.0


async def get_cached(db: AsyncSession, barcode: str) -> JournalBarcodeCache | None:
    row = (await db.execute(select(JournalBarcodeCache).where(
        JournalBarcodeCache.barcode == barcode,
    ))).scalar_one_or_none()
    if row is None or row.fetched_at < datetime.now(timezone.utc) - CACHE_TTL:
        return None
    return row


async def fetch_open_food_facts(barcode: str) -> dict | None:
    async with httpx.AsyncClient(timeout=OFF_TIMEOUT_SEC) as client:
        response = await client.get(OFF_URL.format(barcode=barcode))
    if response.status_code != 200:
        return None
    data = response.json()
    if data.get("status") != 1:
        return None
    return data.get("product") or None
