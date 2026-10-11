"""add_positions_table

Revision ID: b1c2d3e4f5a6
Revises: a7b8c9d0e1f2
Create Date: 2026-10-11 05:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, Sequence[str], None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Должности, которые раньше были захардкожены в app/core/roles.py.
# Переносим их в таблицу positions, чтобы владелец мог создавать новые
# должности и менять иерархию через API, не трогая код.
DEFAULT_POSITIONS = [
    {"code": "owner", "name": "Владелец", "level": 0, "scope": "global", "is_system": True},
    {"code": "shop_chief", "name": "Начальник цеха", "level": 1, "scope": "workshop", "is_system": False},
    {"code": "section_chief", "name": "Начальник участка", "level": 2, "scope": "section", "is_system": False},
    {"code": "master", "name": "Мастер участка", "level": 3, "scope": "section", "is_system": False},
    {"code": "assistant_master", "name": "Помощник мастера участка", "level": 4, "scope": "section", "is_system": False},
    {"code": "worker", "name": "Рабочий", "level": 5, "scope": "self", "is_system": True},
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    if 'positions' not in existing_tables:
        op.create_table(
            'positions',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('code', sa.String(length=50), nullable=False),
            sa.Column('name', sa.String(length=200), nullable=False),
            sa.Column('level', sa.Integer(), nullable=False),
            sa.Column('scope', sa.String(length=20), nullable=False, server_default='section'),
            sa.Column('is_system', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('code', name='uq_positions_code'),
            sa.UniqueConstraint('level', name='uq_positions_level'),
        )

    positions_table = sa.table(
        'positions',
        sa.column('code', sa.String),
        sa.column('name', sa.String),
        sa.column('level', sa.Integer),
        sa.column('scope', sa.String),
        sa.column('is_system', sa.Boolean),
    )

    existing_codes = {row[0] for row in bind.execute(sa.text("SELECT code FROM positions")).fetchall()}
    rows_to_insert = [p for p in DEFAULT_POSITIONS if p["code"] not in existing_codes]
    if rows_to_insert:
        op.bulk_insert(positions_table, rows_to_insert)


def downgrade() -> None:
    op.drop_table('positions')
