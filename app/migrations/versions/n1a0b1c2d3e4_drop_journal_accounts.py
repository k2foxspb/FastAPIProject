"""drop_journal_accounts

Удаление счетов журнала: переводы между счетами больше не поддерживаются,
поэтому операции-переводы помечаются удалёнными, а таблица счетов и связанные
колонки удаляются.

Revision ID: n1a0b1c2d3e4
Revises: m1a0b1c2d3e4
Create Date: 2026-11-06 18:20:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "n1a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "m1a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BigIntPK = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.execute(
        "UPDATE journal_transactions SET deleted_at = CURRENT_TIMESTAMP, "
        "server_rev = server_rev + 1 WHERE direction = 'transfer'"
    )
    op.drop_index("ix_journal_transactions_account_date", table_name="journal_transactions")
    with op.batch_alter_table("journal_transactions") as batch:
        batch.drop_constraint("fk_journal_transactions_account_id_journal_accounts", type_="foreignkey")
        batch.drop_constraint("fk_journal_transactions_to_account_id_journal_accounts", type_="foreignkey")
        batch.drop_column("account_id")
        batch.drop_column("to_account_id")
        batch.drop_column("transfer_pair_uuid")
        batch.drop_constraint("ck_journal_transactions_direction_valid", type_="check")
        batch.create_check_constraint(
            "ck_journal_transactions_direction_valid", "direction IN ('expense', 'income')"
        )
    with op.batch_alter_table("journal_import_batches") as batch:
        batch.drop_constraint("fk_journal_import_batches_account_id_journal_accounts", type_="foreignkey")
        batch.drop_column("account_id")
    op.drop_table("journal_accounts")


def downgrade() -> None:
    op.create_table(
        "journal_accounts",
        sa.Column("id", BigIntPK, primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("client_uuid", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("server_rev", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("opening_balance_kop", sa.BigInteger(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE",
                                name="fk_journal_accounts_user_id_users"),
        sa.UniqueConstraint("user_id", "client_uuid", name="uq_journal_accounts_user_uuid"),
    )
    with op.batch_alter_table("journal_import_batches") as batch:
        batch.add_column(sa.Column("account_id", BigIntPK, nullable=True))
        batch.create_foreign_key("fk_journal_import_batches_account_id_journal_accounts",
                                 "journal_accounts", ["account_id"], ["id"], ondelete="SET NULL")
    with op.batch_alter_table("journal_transactions") as batch:
        batch.drop_constraint("ck_journal_transactions_direction_valid", type_="check")
        batch.add_column(sa.Column("account_id", BigIntPK, nullable=True))
        batch.add_column(sa.Column("to_account_id", BigIntPK, nullable=True))
        batch.add_column(sa.Column("transfer_pair_uuid", sa.String(36), nullable=True))
        batch.create_foreign_key("fk_journal_transactions_account_id_journal_accounts",
                                 "journal_accounts", ["account_id"], ["id"], ondelete="SET NULL")
        batch.create_foreign_key("fk_journal_transactions_to_account_id_journal_accounts",
                                 "journal_accounts", ["to_account_id"], ["id"], ondelete="SET NULL")
        batch.create_check_constraint(
            "ck_journal_transactions_direction_valid", "direction IN ('expense', 'income', 'transfer')"
        )
    op.create_index("ix_journal_transactions_account_date", "journal_transactions",
                    ["account_id", "transaction_date"])
