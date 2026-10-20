from datetime import datetime
from sqlalchemy import (
    Integer,
    String,
    ForeignKey,
    DateTime,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from typing import TYPE_CHECKING
from app.database import Base

if TYPE_CHECKING:
    from app.models.users import User

# Статусы заявления
STATEMENT_STATUS_DRAFT = "draft"
STATEMENT_STATUS_PENDING = "pending"
STATEMENT_STATUS_REVISION = "revision"
STATEMENT_STATUS_RESUBMITTED = "resubmitted"
STATEMENT_STATUS_APPROVED = "approved"
STATEMENT_STATUS_REJECTED = "rejected"
STATEMENT_STATUS_CANCELLED = "cancelled"

STATEMENT_STATUSES = [
    STATEMENT_STATUS_DRAFT,
    STATEMENT_STATUS_PENDING,
    STATEMENT_STATUS_REVISION,
    STATEMENT_STATUS_RESUBMITTED,
    STATEMENT_STATUS_APPROVED,
    STATEMENT_STATUS_REJECTED,
    STATEMENT_STATUS_CANCELLED,
]

# Отдельный статус строки StatementApproval для тех, кого нужно просто
# уведомить о заявлении, без требования согласования - такие строки не
# учитываются при определении "кто ещё должен согласовать" и не могут быть
# подтверждены/отклонены (аналогично TIMESHEET_APPROVAL_STATUS_NOTIFIED).
STATEMENT_APPROVAL_STATUS_NOTIFIED = "notified"

# Роль получателя шаблона заявления (StatementTemplateRecipient.role):
# обязательный согласующий или просто уведомляемый - по аналогии с режимами
# "Согласование"/"Уведомление", которые сотрудник выбирает вручную для
# свободного заявления.
STATEMENT_TEMPLATE_RECIPIENT_APPROVE = "approve"
STATEMENT_TEMPLATE_RECIPIENT_NOTIFY = "notify"


class StatementTemplate(Base):
    """
    Шаблон заявления, настраиваемый администратором в админке: название
    (например, "Заявление на отпуск"), необязательный текст по умолчанию и
    фиксированный набор обязательных согласующих и просто уведомляемых -
    сотрудник в табеле выбирает такой шаблон вместо того, чтобы вручную
    отмечать руководителей для каждого заявления.
    """
    __tablename__ = "statement_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    default_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    recipients: Mapped[list["StatementTemplateRecipient"]] = relationship(
        "StatementTemplateRecipient", back_populates="template", cascade="all, delete-orphan"
    )


class StatementTemplateRecipient(Base):
    """Один согласующий или уведомляемый, закреплённый администратором за шаблоном заявления."""
    __tablename__ = "statement_template_recipients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("statement_templates.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default=STATEMENT_TEMPLATE_RECIPIENT_APPROVE)

    template: Mapped["StatementTemplate"] = relationship("StatementTemplate", back_populates="recipients")
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])


class Statement(Base):
    """
    Свободное заявление сотрудника - текстовое сообщение, которое
    отправляется на согласование выбранным сотрудником вышестоящим
    руководителям (все обязательные согласующие должны согласовать, отказ
    любого отклоняет заявление целиком), а также опционально просто
    уведомляет дополнительных руководителей без требования согласования.
    """
    __tablename__ = "statements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    template_id: Mapped[int | None] = mapped_column(
        ForeignKey("statement_templates.id", ondelete="SET NULL"), nullable=True
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default=STATEMENT_STATUS_PENDING)
    round: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewer_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    author: Mapped["User"] = relationship("User", foreign_keys=[author_id])
    reviewer: Mapped["User | None"] = relationship("User", foreign_keys=[reviewer_id])
    template: Mapped["StatementTemplate | None"] = relationship("StatementTemplate", foreign_keys=[template_id])
    approvals: Mapped[list["StatementApproval"]] = relationship(
        "StatementApproval", back_populates="statement", cascade="all, delete-orphan"
    )
    logs: Mapped[list["StatementAuditLog"]] = relationship(
        "StatementAuditLog", back_populates="statement", cascade="all, delete-orphan", order_by="StatementAuditLog.created_at.asc()"
    )


class StatementApproval(Base):
    """
    Один согласующий (или просто уведомляемый - см.
    STATEMENT_APPROVAL_STATUS_NOTIFIED) по конкретному заявлению. Пока хотя
    бы один обязательный согласующий не принял решение (status="pending"),
    заявление в целом остаётся "pending"; если любой из них отклонит - всё
    заявление становится "revision" (на доработке).
    """
    __tablename__ = "statement_approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    statement_id: Mapped[int] = mapped_column(ForeignKey("statements.id", ondelete="CASCADE"), nullable=False)
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=STATEMENT_STATUS_PENDING)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    statement: Mapped["Statement"] = relationship("Statement", back_populates="approvals")
    approver: Mapped["User | None"] = relationship("User", foreign_keys=[approver_id])


class StatementAuditLog(Base):
    """
    Журнал истории действий по заявлению: создание черновика, отправка на согласование,
    согласование каждым руководителем, возврат на доработку с причиной,
    повторная отправка с выбранным вариантом (со всеми или только с вернувшим),
    редактирование, отмена.
    """
    __tablename__ = "statement_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    statement_id: Mapped[int] = mapped_column(ForeignKey("statements.id", ondelete="CASCADE"), nullable=False)
    round: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    # actions: "draft_created", "submitted", "approved", "returned_for_revision", "resubmitted", "edited", "cancelled", "fully_approved"
    resubmit_mode: Mapped[str | None] = mapped_column(String(30), nullable=True) # "all", "rejected_only"
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    message_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    statement: Mapped["Statement"] = relationship("Statement", back_populates="logs")
    actor: Mapped["User | None"] = relationship("User", foreign_keys=[actor_id])
