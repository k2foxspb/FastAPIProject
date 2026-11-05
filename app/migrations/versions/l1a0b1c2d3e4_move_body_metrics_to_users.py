"""move_body_metrics_to_users

Рост и вес переезжают из настроек журнала в профиль пользователя, добавляется дата рождения.

Revision ID: l1a0b1c2d3e4
Revises: k1a0b1c2d3e4
Create Date: 2026-11-05 21:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "l1a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "k1a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("birth_date", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("height_cm", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("weight_kg", sa.Numeric(5, 1), nullable=True))
    op.execute(
        """
        UPDATE users SET
            height_cm = (SELECT js.height_cm FROM journal_settings js
                         WHERE js.user_id = users.id AND js.deleted_at IS NULL),
            weight_kg = (SELECT js.weight_kg FROM journal_settings js
                         WHERE js.user_id = users.id AND js.deleted_at IS NULL)
        WHERE EXISTS (SELECT 1 FROM journal_settings js
                      WHERE js.user_id = users.id AND js.deleted_at IS NULL)
        """
    )
    op.drop_column("journal_settings", "weight_kg")
    op.drop_column("journal_settings", "height_cm")


def downgrade() -> None:
    op.add_column("journal_settings", sa.Column("height_cm", sa.Integer(), nullable=True))
    op.add_column("journal_settings", sa.Column("weight_kg", sa.Numeric(5, 1), nullable=True))
    op.drop_column("users", "weight_kg")
    op.drop_column("users", "height_cm")
    op.drop_column("users", "birth_date")
