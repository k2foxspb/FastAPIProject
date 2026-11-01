"""journal_settings_body_metrics

Рост и вес в настройках журнала.

Revision ID: j6a0b1c2d3e4
Revises: j4a0b1c2d3e4
Create Date: 2026-11-01 15:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "j6a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "j4a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("journal_settings", sa.Column("height_cm", sa.Integer(), nullable=True))
    op.add_column("journal_settings", sa.Column("weight_kg", sa.Numeric(5, 1), nullable=True))


def downgrade() -> None:
    op.drop_column("journal_settings", "weight_kg")
    op.drop_column("journal_settings", "height_cm")
