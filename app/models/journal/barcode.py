"""
Глобальный кэш ответов Open Food Facts по штрихкоду (не персональные данные).
Личная копия продукта сохраняется отдельно в journal_foods.
"""
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.journal.base import utcnow


class JournalBarcodeCache(Base):
    __tablename__ = "journal_barcode_cache"

    barcode: Mapped[str] = mapped_column(String(32), primary_key=True)
    found: Mapped[bool] = mapped_column(default=False, nullable=False)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    brand: Mapped[str | None] = mapped_column(String(100), nullable=True)
    kcal_100: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    protein_100: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    fat_100: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    carbs_100: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    serving_g: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
