from datetime import datetime, date as date_type
from sqlalchemy import (
    Integer,
    String,
    ForeignKey,
    DateTime,
    Date,
    Boolean,
    Numeric,
    Text,
    JSON,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from typing import TYPE_CHECKING
from app.database import Base

if TYPE_CHECKING:
    from app.models.users import User


# Статусы записи о сданной продукции
PRODUCTION_STATUS_DRAFT = "draft"
PRODUCTION_STATUS_PENDING = "pending"
PRODUCTION_STATUS_APPROVED = "approved"
PRODUCTION_STATUS_REJECTED = "rejected"

PRODUCTION_STATUSES = [
    PRODUCTION_STATUS_DRAFT,
    PRODUCTION_STATUS_PENDING,
    PRODUCTION_STATUS_APPROVED,
    PRODUCTION_STATUS_REJECTED,
]

# Отдельный статус строки TimesheetEntryApproval для руководителей, которых
# нужно просто уведомить об изменении часов, без требования согласования -
# такие строки не учитываются при определении "кто ещё должен согласовать"
# и не могут быть подтверждены/отклонены.
TIMESHEET_APPROVAL_STATUS_NOTIFIED = "notified"


class TimesheetEntry(Base):
    """
    Запись табеля учёта рабочего времени - количество отработанных часов
    конкретным пользователем за конкретный день. Одна запись на пользователя
    и день (уникальность по (user_id, date)).

    Изменение часов сотрудником за самого себя требует согласования
    вышестоящим руководителем (статус переходит в "pending"); изменение,
    внесённое руководителем за подчинённого, считается уже согласованным
    и сразу получает статус "approved".
    """
    __tablename__ = "timesheet_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_timesheet_entries_user_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    date: Mapped[date_type] = mapped_column(Date, nullable=False)
    # Основное (не сверхурочное) время за день.
    hours: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    # Сверхурочное время за день - вводится явно (отдельно от основного),
    # чтобы в сводных таблицах/выгрузке не приходилось высчитывать его
    # автоматически по норме рабочего дня.
    overtime_hours: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    # Текстовая отметка вместо часов - например "Больничный лист", "Отпуск",
    # "Прогул" и т.п. Если заполнена, UI показывает её вместо числа часов,
    # а сами часы при этом могут оставаться нулевыми.
    text_value: Mapped[str | None] = mapped_column(String(100), nullable=True)
    comment: Mapped[str | None] = mapped_column(String, nullable=True)

    # Статус согласования изменения часов (см. PRODUCTION_STATUS_* - используются те же значения).
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=PRODUCTION_STATUS_APPROVED)
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewer_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Номер раунда согласования - увеличивается при каждой отправке на
    # согласование (или правке руководителем), чтобы сгруппировать историю
    # (TimesheetAuditLog/TimesheetEntryApproval) по конкретным событиям.
    approval_round: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
    reviewer: Mapped["User | None"] = relationship("User", foreign_keys=[reviewer_id])
    approvals: Mapped[list["TimesheetEntryApproval"]] = relationship(
        "TimesheetEntryApproval", back_populates="entry", cascade="all, delete-orphan"
    )
    logs: Mapped[list["TimesheetAuditLog"]] = relationship(
        "TimesheetAuditLog", back_populates="entry", cascade="all, delete-orphan"
    )


class TimesheetEntryApproval(Base):
    """
    Один обязательный согласующий в рамках одного раунда согласования
    изменения часов (TimesheetEntry.approval_round) - чтобы можно было
    требовать согласования сразу от нескольких вышестоящих руководителей:
    пока хотя бы один не согласовал (status="pending"), запись в целом
    остаётся "pending"; если любой из них отклонит - вся запись становится
    "rejected".
    """
    __tablename__ = "timesheet_entry_approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("timesheet_entries.id", ondelete="CASCADE"), nullable=False)
    round: Mapped[int] = mapped_column(Integer, nullable=False)
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=PRODUCTION_STATUS_PENDING)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    entry: Mapped["TimesheetEntry"] = relationship("TimesheetEntry", back_populates="approvals")
    approver: Mapped["User | None"] = relationship("User", foreign_keys=[approver_id])


class TimesheetAuditLog(Base):
    """
    Журнал событий по записи табеля: отправка на согласование, повторная
    отправка, правка часов вышестоящим руководителем напрямую (без
    согласования). Каждая такая запись открывает новый "раунд"
    (TimesheetEntry.approval_round) - используется, чтобы сгруппировать
    историю карточки дня по конкретным событиям отправки на согласование.
    """
    __tablename__ = "timesheet_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("timesheet_entries.id", ondelete="CASCADE"), nullable=False)
    round: Mapped[int] = mapped_column(Integer, nullable=False)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(30), nullable=False)
    # action: "submitted", "resubmitted", "updated_by_supervisor"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    entry: Mapped["TimesheetEntry"] = relationship("TimesheetEntry", back_populates="logs")
    actor: Mapped["User | None"] = relationship("User", foreign_keys=[actor_id])


class Product(Base):
    """Справочник продукции/приборов, которые сотрудники сдают по итогам дня."""
    __tablename__ = "production_products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str | None] = mapped_column(String(100), nullable=True, unique=True)
    unit: Mapped[str] = mapped_column(String(50), nullable=False, default="шт")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    items: Mapped[list["ProductionEntryItem"]] = relationship("ProductionEntryItem", back_populates="product")


class ProductionEntry(Base):
    """
    Запись о сданной продукции за один день одного сотрудника - "шапка" дня
    с перечнем позиций (ProductionEntryItem) и статусом согласования.
    Одна запись на пользователя и день.
    """
    __tablename__ = "production_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_production_entries_user_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    date: Mapped[date_type] = mapped_column(Date, nullable=False)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default=PRODUCTION_STATUS_DRAFT)

    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewer_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
    reviewer: Mapped["User | None"] = relationship("User", foreign_keys=[reviewer_id])
    items: Mapped[list["ProductionEntryItem"]] = relationship(
        "ProductionEntryItem", back_populates="entry", cascade="all, delete-orphan"
    )
    logs: Mapped[list["ProductionAuditLog"]] = relationship(
        "ProductionAuditLog", back_populates="entry", cascade="all, delete-orphan"
    )


class ProductionEntryItem(Base):
    """Одна позиция сданной продукции в рамках дневной записи ProductionEntry."""
    __tablename__ = "production_entry_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("production_entries.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("production_products.id", ondelete="RESTRICT"), nullable=False)
    quantity: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    comment: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    entry: Mapped["ProductionEntry"] = relationship("ProductionEntry", back_populates="items")
    product: Mapped["Product"] = relationship("Product", back_populates="items")


class ProductionAuditLog(Base):
    """
    Журнал действий по записи сданной продукции: создание, изменение,
    отправка на согласование, подтверждение, отклонение. Хранит старые и
    новые значения (JSON) и комментарий (например, причину отклонения).
    """
    __tablename__ = "production_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("production_entries.id", ondelete="CASCADE"), nullable=False)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(30), nullable=False)
    # action: "created", "updated", "submitted", "approved", "rejected", "resubmitted"
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    old_values: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    new_values: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    entry: Mapped["ProductionEntry"] = relationship("ProductionEntry", back_populates="logs")
    actor: Mapped["User | None"] = relationship("User", foreign_keys=[actor_id])
