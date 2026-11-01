"""journal_phase3

Финансы и импорт банковских выписок.

Revision ID: j3a0b1c2d3e4
Revises: j2a0b1c2d3e4
Create Date: 2026-11-01 09:10:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "j3a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "j2a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BigIntPK = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _entity_columns(table: str) -> list:
    return [
        sa.Column("id", BigIntPK, primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("client_uuid", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("server_rev", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE", name=f"fk_{table}_user_id_users"),
        sa.PrimaryKeyConstraint("id", name=f"pk_{table}"),
        sa.UniqueConstraint("user_id", "client_uuid", name=f"uq_{table}_user_uuid"),
    ]


def _entity_indexes(table: str) -> None:
    op.create_index(f"ix_{table}_user_id", table, ["user_id"])
    op.create_index(f"ix_{table}_user_rev", table, ["user_id", "server_rev"])


def upgrade() -> None:
    op.create_table(
        "journal_accounts", *_entity_columns("journal_accounts"),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("opening_balance_kop", sa.BigInteger(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
    )
    _entity_indexes("journal_accounts")

    op.create_table(
        "journal_finance_categories", *_entity_columns("journal_finance_categories"),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("parent_id", BigIntPK, nullable=True),
        sa.Column("icon", sa.String(50), nullable=True),
        sa.Column("color", sa.String(20), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["parent_id"], ["journal_finance_categories.id"], ondelete="SET NULL",
                                name="fk_journal_finance_categories_parent_id_journal_finance_categories"),
    )
    _entity_indexes("journal_finance_categories")

    op.create_table(
        "journal_import_profiles", *_entity_columns("journal_import_profiles"),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("file_format", sa.String(10), nullable=False),
        sa.Column("header_fingerprint", sa.String(64), nullable=False),
        sa.Column("mapping", sa.JSON(), nullable=False),
        sa.Column("date_format", sa.String(40), nullable=True),
        sa.Column("delimiter", sa.String(4), nullable=True),
        sa.UniqueConstraint("user_id", "header_fingerprint", name="uq_journal_import_profile_header"),
    )
    _entity_indexes("journal_import_profiles")

    op.create_table(
        "journal_import_batches", *_entity_columns("journal_import_batches"),
        sa.Column("account_id", BigIntPK, nullable=True),
        sa.Column("profile_id", BigIntPK, nullable=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("content_fingerprint", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("imported_count", sa.Integer(), nullable=False),
        sa.Column("duplicate_count", sa.Integer(), nullable=False),
        sa.Column("reverted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["account_id"], ["journal_accounts.id"], ondelete="SET NULL",
                                name="fk_journal_import_batches_account_id_journal_accounts"),
        sa.ForeignKeyConstraint(["profile_id"], ["journal_import_profiles.id"], ondelete="SET NULL",
                                name="fk_journal_import_batches_profile_id_journal_import_profiles"),
    )
    _entity_indexes("journal_import_batches")
    op.create_index("ix_journal_import_batches_user_created", "journal_import_batches", ["user_id", "created_at"])

    op.create_table(
        "journal_transactions", *_entity_columns("journal_transactions"),
        sa.Column("account_id", BigIntPK, nullable=True),
        sa.Column("to_account_id", BigIntPK, nullable=True),
        sa.Column("category_id", BigIntPK, nullable=True),
        sa.Column("import_batch_id", BigIntPK, nullable=True),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column("direction", sa.String(10), nullable=False),
        sa.Column("amount_kop", sa.BigInteger(), nullable=False),
        sa.Column("description", sa.String(255), nullable=False),
        sa.Column("merchant", sa.String(255), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("external_id", sa.String(255), nullable=True),
        sa.Column("transfer_pair_uuid", sa.String(36), nullable=True),
        sa.Column("review_required", sa.Boolean(), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["journal_accounts.id"], ondelete="SET NULL",
                                name="fk_journal_transactions_account_id_journal_accounts"),
        sa.ForeignKeyConstraint(["to_account_id"], ["journal_accounts.id"], ondelete="SET NULL",
                                name="fk_journal_transactions_to_account_id_journal_accounts"),
        sa.ForeignKeyConstraint(["category_id"], ["journal_finance_categories.id"], ondelete="SET NULL",
                                name="fk_journal_transactions_category_id_journal_finance_categories"),
        sa.ForeignKeyConstraint(["import_batch_id"], ["journal_import_batches.id"], ondelete="SET NULL",
                                name="fk_journal_transactions_import_batch_id_journal_import_batches"),
        sa.CheckConstraint("amount_kop > 0", name="ck_journal_transactions_amount_positive"),
        sa.CheckConstraint("direction IN ('expense', 'income', 'transfer')", name="ck_journal_transactions_direction_valid"),
    )
    _entity_indexes("journal_transactions")
    op.create_index("ix_journal_transactions_user_date", "journal_transactions", ["user_id", "transaction_date"])
    op.create_index("ix_journal_transactions_account_date", "journal_transactions", ["account_id", "transaction_date"])
    op.create_index("ix_journal_transactions_import_batch", "journal_transactions", ["import_batch_id"])

    op.create_table(
        "journal_budgets", *_entity_columns("journal_budgets"),
        sa.Column("category_id", BigIntPK, nullable=True),
        sa.Column("period_month", sa.String(7), nullable=False),
        sa.Column("limit_kop", sa.BigInteger(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["category_id"], ["journal_finance_categories.id"], ondelete="SET NULL",
                                name="fk_journal_budgets_category_id_journal_finance_categories"),
        sa.CheckConstraint("limit_kop > 0", name="ck_journal_budgets_limit_positive"),
    )
    _entity_indexes("journal_budgets")

    op.create_table(
        "journal_import_rules", *_entity_columns("journal_import_rules"),
        sa.Column("match_text", sa.String(200), nullable=False),
        sa.Column("match_field", sa.String(20), nullable=False),
        sa.Column("category_id", BigIntPK, nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["category_id"], ["journal_finance_categories.id"], ondelete="SET NULL",
                                name="fk_journal_import_rules_category_id_journal_finance_categories"),
    )
    _entity_indexes("journal_import_rules")


def downgrade() -> None:
    for table in (
        "journal_import_rules", "journal_budgets", "journal_transactions", "journal_import_batches",
        "journal_import_profiles", "journal_finance_categories", "journal_accounts",
    ):
        op.drop_table(table)
