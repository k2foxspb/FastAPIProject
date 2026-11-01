"""
Цели журнала (фаза 4): единая цель с прогрессом по выбранному источнику.
Прогресс считается сервисом goals из данных, сама модель его не хранит.
"""
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.journal.base import JournalEntityMixin, entity_table_args


class JournalGoal(JournalEntityMixin, Base):
    __tablename__ = "journal_goals"
    __table_args__ = entity_table_args("journal_goals")

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # tracker | weight | water | kcal | protein | fat | carbs | expense_total | expense_category
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_uuid: Mapped[str | None] = mapped_column(String(36), nullable=True)
    target_value: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    start_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    # none | day | week | month
    period: Mapped[str] = mapped_column(String(10), default="none", nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    # reach | not_exceed
    direction: Mapped[str] = mapped_column(String(20), default="reach", nullable=False)
    # active | achieved | failed | archived
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
