"""add_gender_to_users

Пол пользователя (male/female) для дефолтных аватарок.

Revision ID: k1a0b1c2d3e4
Revises: j6a0b1c2d3e4
Create Date: 2026-11-01 21:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "k1a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "j6a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("gender", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "gender")
