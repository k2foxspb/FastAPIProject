"""
Диета (фаза 2): типы приёмов пищи, личная база продуктов и рецептов,
записи о еде и воде.

Записи о еде хранят снимок названия и КБЖУ на момент записи, поэтому правка
или удаление продукта из базы не меняет историю. Вода и еда - append-only:
дневные итоги всегда пересчитываются из записей.
"""
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import (
    Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Time,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.journal.base import BigIntPK, JournalEntityMixin, entity_table_args


class JournalMealType(JournalEntityMixin, Base):
    """Тип приёма пищи (завтрак, обед, ...). Из default_time строится ежедневное напоминание."""
    __tablename__ = "journal_meal_types"
    __table_args__ = entity_table_args("journal_meal_types")

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    default_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reminder_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class JournalFood(JournalEntityMixin, Base):
    """Продукт или блюдо-рецепт личной базы пользователя (КБЖУ на 100 г)."""
    __tablename__ = "journal_foods"
    __table_args__ = entity_table_args(
        "journal_foods",
        Index("ix_journal_foods_user_barcode", "user_id", "barcode"),
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    brand: Mapped[str | None] = mapped_column(String(100), nullable=True)
    kcal_100: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0, nullable=False)
    protein_100: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0, nullable=False)
    fat_100: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0, nullable=False)
    carbs_100: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0, nullable=False)
    serving_g: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source: Mapped[str] = mapped_column(String(10), default="manual", nullable=False)  # manual|ai|off|recipe
    is_recipe: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Вес готового блюда, г (для рецептов; None - сумма весов ингредиентов)
    recipe_yield_g: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    use_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class JournalRecipeItem(JournalEntityMixin, Base):
    """Ингредиент рецепта: ссылка на продукт базы и его вес."""
    __tablename__ = "journal_recipe_items"
    __table_args__ = entity_table_args("journal_recipe_items")

    recipe_id: Mapped[int] = mapped_column(
        BigIntPK, ForeignKey("journal_foods.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ingredient_id: Mapped[int] = mapped_column(
        BigIntPK, ForeignKey("journal_foods.id", ondelete="CASCADE"), nullable=False, index=True
    )
    grams: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)


class JournalFoodEntry(JournalEntityMixin, Base):
    """Запись о съеденном: снимок названия и КБЖУ порции."""
    __tablename__ = "journal_food_entries"
    __table_args__ = entity_table_args(
        "journal_food_entries",
        Index("ix_journal_food_entries_user_date", "user_id", "entry_date"),
    )

    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    entry_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    meal_type_id: Mapped[int | None] = mapped_column(
        BigIntPK, ForeignKey("journal_meal_types.id", ondelete="SET NULL"), nullable=True, index=True
    )
    food_id: Mapped[int | None] = mapped_column(
        BigIntPK, ForeignKey("journal_foods.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    grams: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    kcal: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    protein: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    fat: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    carbs: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)


class JournalWaterEntry(JournalEntityMixin, Base):
    """Порция воды (append-only: итог дня - сумма записей)."""
    __tablename__ = "journal_water_entries"
    __table_args__ = entity_table_args(
        "journal_water_entries",
        Index("ix_journal_water_entries_user_date", "user_id", "entry_date"),
        CheckConstraint("amount_ml >= 1 AND amount_ml <= 5000", name="amount_range"),
    )

    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    entry_time: Mapped[time] = mapped_column(Time, nullable=False)
    amount_ml: Mapped[int] = mapped_column(Integer, nullable=False)
