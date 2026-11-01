"""journal_phase4

Цели, аналитика и кэш штрихкодов.

Revision ID: j4a0b1c2d3e4
Revises: j3a0b1c2d3e4
Create Date: 2026-11-01 11:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "j4a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "j3a0b1c2d3e4"
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


def upgrade() -> None:
    op.create_table(
        "journal_goals", *_entity_columns("journal_goals"),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("source_type", sa.String(20), nullable=False),
        sa.Column("source_uuid", sa.String(36), nullable=True),
        sa.Column("target_value", sa.Numeric(14, 4), nullable=False),
        sa.Column("direction", sa.String(20), nullable=False),
        sa.Column("unit", sa.String(20), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_journal_goals_user_id", "journal_goals", ["user_id"])
    op.create_index("ix_journal_goals_user_rev", "journal_goals", ["user_id", "server_rev"])

    op.create_table(
        "journal_barcode_cache",
        sa.Column("barcode", sa.String(32), primary_key=True),
        sa.Column("found", sa.Boolean(), nullable=False),
        sa.Column("name", sa.String(200), nullable=True),
        sa.Column("brand", sa.String(100), nullable=True),
        sa.Column("kcal_100", sa.Numeric(8, 2), nullable=True),
        sa.Column("protein_100", sa.Numeric(8, 2), nullable=True),
        sa.Column("fat_100", sa.Numeric(8, 2), nullable=True),
        sa.Column("carbs_100", sa.Numeric(8, 2), nullable=True),
        sa.Column("serving_g", sa.Numeric(8, 2), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("journal_barcode_cache")
    op.drop_table("journal_goals")
