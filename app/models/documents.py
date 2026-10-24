from datetime import datetime
from sqlalchemy import Integer, String, Text, ForeignKey, DateTime, Boolean, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from typing import TYPE_CHECKING
from app.database import Base

if TYPE_CHECKING:
    from app.models.users import User

# Статусы документа (жизненный цикл с учётом согласования подписантами).
DOCUMENT_STATUS_DRAFT = "draft"
DOCUMENT_STATUS_PENDING_APPROVAL = "pending_approval"
DOCUMENT_STATUS_APPROVED = "approved"
DOCUMENT_STATUS_REJECTED = "rejected"
DOCUMENT_STATUS_SENT = "sent"
DOCUMENT_STATUS_ARCHIVED = "archived"

DOCUMENT_STATUSES = [
    DOCUMENT_STATUS_DRAFT,
    DOCUMENT_STATUS_PENDING_APPROVAL,
    DOCUMENT_STATUS_APPROVED,
    DOCUMENT_STATUS_REJECTED,
    DOCUMENT_STATUS_SENT,
    DOCUMENT_STATUS_ARCHIVED,
]

# Статусы решения подписанта по документу.
DOCUMENT_APPROVAL_STATUS_PENDING = "pending"
DOCUMENT_APPROVAL_STATUS_APPROVED = "approved"
DOCUMENT_APPROVAL_STATUS_REJECTED = "rejected"

# Статусы ознакомления назначенного пользователя.
DOCUMENT_ASSIGNMENT_STATUS_PENDING = "pending"
DOCUMENT_ASSIGNMENT_STATUS_CONFIRMED = "confirmed"

# Типы адресации при назначении документа на ознакомление.
DOCUMENT_TARGET_USER = "user"
DOCUMENT_TARGET_SECTION = "department"
DOCUMENT_TARGET_WORKSHOP = "workshop"


class DocumentCategory(Base):
    """Категория документов - используется как папка для группировки документов."""
    __tablename__ = "document_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    documents: Mapped[list["Document"]] = relationship("Document", back_populates="category")


class Document(Base):
    """
    Документ для ознакомления сотрудниками. Может потребовать согласования
    подписантами (см. DocumentApproval) прежде, чем его можно будет разослать
    получателям на ознакомление (см. DocumentAssignment).
    """
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("document_categories.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    confirmation_button_text: Mapped[str] = mapped_column(
        String(100), nullable=False, default="Ознакомлен", server_default="Ознакомлен"
    )
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default=DOCUMENT_STATUS_DRAFT, server_default=DOCUMENT_STATUS_DRAFT
    )
    approval_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    approval_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approval_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Версия документа: увеличивается при повторной отправке на согласование
    # после отклонения, чтобы отделить новые решения подписантов от истории.
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    category: Mapped["DocumentCategory"] = relationship("DocumentCategory", back_populates="documents")
    author: Mapped["User"] = relationship("User", foreign_keys=[created_by_user_id])
    approvals: Mapped[list["DocumentApproval"]] = relationship(
        "DocumentApproval", back_populates="document", cascade="all, delete-orphan",
        order_by="DocumentApproval.id.asc()",
    )
    assignments: Mapped[list["DocumentAssignment"]] = relationship(
        "DocumentAssignment", back_populates="document", cascade="all, delete-orphan",
        order_by="DocumentAssignment.id.asc()",
    )
    images: Mapped[list["DocumentImage"]] = relationship(
        "DocumentImage", back_populates="document", cascade="all, delete-orphan",
        order_by="DocumentImage.id.asc()",
    )


class DocumentApproval(Base):
    """
    Решение одного подписанта по конкретной версии документа. При повторной
    отправке документа на согласование после отклонения версия (document_version)
    увеличивается, а предыдущие решения сохраняются в истории.
    """
    __tablename__ = "document_approvals"
    __table_args__ = (
        UniqueConstraint(
            "document_id", "approver_user_id", "document_version",
            name="uq_document_approvals_doc_approver_version",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    approver_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    document_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=DOCUMENT_APPROVAL_STATUS_PENDING,
        server_default=DOCUMENT_APPROVAL_STATUS_PENDING,
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_reminder_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    document: Mapped["Document"] = relationship("Document", back_populates="approvals")
    approver: Mapped["User"] = relationship("User", foreign_keys=[approver_user_id])


class DocumentAssignment(Base):
    """Назначение документа конкретному пользователю на ознакомление."""
    __tablename__ = "document_assignments"
    __table_args__ = (
        UniqueConstraint("document_id", "assigned_to_user_id", name="uq_document_assignments_doc_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    assigned_to_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    assigned_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # Как был адресован этот пользователь: напрямую, через отдел (участок) или через цех.
    target_type: Mapped[str] = mapped_column(String(20), nullable=False, default=DOCUMENT_TARGET_USER)
    target_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=DOCUMENT_ASSIGNMENT_STATUS_PENDING,
        server_default=DOCUMENT_ASSIGNMENT_STATUS_PENDING,
    )
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_reminder_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    document: Mapped["Document"] = relationship("Document", back_populates="assignments")
    assigned_to: Mapped["User"] = relationship("User", foreign_keys=[assigned_to_user_id])
    assigned_by: Mapped["User"] = relationship("User", foreign_keys=[assigned_by_user_id])


class DocumentImage(Base):
    """
    Фотография/скан, прикреплённые к документу (например, фото бумажного
    документа или скан подписанного листа). Документ может иметь несколько
    изображений в дополнение к file_url/content.
    """
    __tablename__ = "document_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    image_url: Mapped[str] = mapped_column(String(500), nullable=False)
    thumbnail_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    document: Mapped["Document"] = relationship("Document", back_populates="images")
