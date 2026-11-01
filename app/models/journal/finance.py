"""Финансовые сущности журнала и импорт банковских выписок."""
from datetime import date, datetime

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, JSON,
    String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.journal.base import BigIntPK, JournalEntityMixin, entity_table_args


class JournalAccount(JournalEntityMixin, Base):
    __tablename__ = "journal_accounts"
    __table_args__ = entity_table_args("journal_accounts")

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), default="cash", nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="RUB", nullable=False)
    opening_balance_kop: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class JournalFinanceCategory(JournalEntityMixin, Base):
    __tablename__ = "journal_finance_categories"
    __table_args__ = entity_table_args("journal_finance_categories")

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        BigIntPK, ForeignKey("journal_finance_categories.id", ondelete="SET NULL"), nullable=True
    )
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class JournalImportBatch(JournalEntityMixin, Base):
    __tablename__ = "journal_import_batches"
    __table_args__ = entity_table_args(
        "journal_import_batches", Index("ix_journal_import_batches_user_created", "user_id", "created_at")
    )

    account_id: Mapped[int | None] = mapped_column(
        BigIntPK, ForeignKey("journal_accounts.id", ondelete="SET NULL"), nullable=True
    )
    profile_id: Mapped[int | None] = mapped_column(
        BigIntPK, ForeignKey("journal_import_profiles.id", ondelete="SET NULL"), nullable=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="committed", nullable=False)
    imported_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duplicate_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reverted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class JournalTransaction(JournalEntityMixin, Base):
    __tablename__ = "journal_transactions"
    __table_args__ = entity_table_args(
        "journal_transactions",
        CheckConstraint("amount_kop > 0", name="amount_positive"),
        CheckConstraint("direction IN ('expense', 'income', 'transfer')", name="direction_valid"),
        Index("ix_journal_transactions_user_date", "user_id", "transaction_date"),
        Index("ix_journal_transactions_account_date", "account_id", "transaction_date"),
        Index("ix_journal_transactions_import_batch", "import_batch_id"),
    )

    account_id: Mapped[int | None] = mapped_column(
        BigIntPK, ForeignKey("journal_accounts.id", ondelete="SET NULL"), nullable=True
    )
    to_account_id: Mapped[int | None] = mapped_column(
        BigIntPK, ForeignKey("journal_accounts.id", ondelete="SET NULL"), nullable=True
    )
    category_id: Mapped[int | None] = mapped_column(
        BigIntPK, ForeignKey("journal_finance_categories.id", ondelete="SET NULL"), nullable=True
    )
    import_batch_id: Mapped[int | None] = mapped_column(
        BigIntPK, ForeignKey("journal_import_batches.id", ondelete="SET NULL"), nullable=True
    )
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    direction: Mapped[str] = mapped_column(String(10), nullable=False)
    amount_kop: Mapped[int] = mapped_column(BigInteger, nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    merchant: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    transfer_pair_uuid: Mapped[str | None] = mapped_column(String(36), nullable=True)
    review_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    source: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)


class JournalBudget(JournalEntityMixin, Base):
    __tablename__ = "journal_budgets"
    __table_args__ = entity_table_args("journal_budgets")

    category_id: Mapped[int | None] = mapped_column(
        BigIntPK, ForeignKey("journal_finance_categories.id", ondelete="SET NULL"), nullable=True
    )
    period_month: Mapped[str] = mapped_column(String(7), nullable=False)
    limit_kop: Mapped[int] = mapped_column(BigInteger, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class JournalImportProfile(JournalEntityMixin, Base):
    __tablename__ = "journal_import_profiles"
    __table_args__ = entity_table_args(
        "journal_import_profiles", UniqueConstraint("user_id", "header_fingerprint", name="uq_journal_import_profile_header")
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    file_format: Mapped[str] = mapped_column(String(10), nullable=False)
    header_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    mapping: Mapped[dict] = mapped_column(JSON, nullable=False)
    date_format: Mapped[str | None] = mapped_column(String(40), nullable=True)
    delimiter: Mapped[str | None] = mapped_column(String(4), nullable=True)


class JournalImportRule(JournalEntityMixin, Base):
    __tablename__ = "journal_import_rules"
    __table_args__ = entity_table_args("journal_import_rules")

    match_text: Mapped[str] = mapped_column(String(200), nullable=False)
    match_field: Mapped[str] = mapped_column(String(20), default="description", nullable=False)
    category_id: Mapped[int | None] = mapped_column(
        BigIntPK, ForeignKey("journal_finance_categories.id", ondelete="SET NULL"), nullable=True
    )
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
