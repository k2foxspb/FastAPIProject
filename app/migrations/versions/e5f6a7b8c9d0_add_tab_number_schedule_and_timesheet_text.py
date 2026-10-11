"""add_tab_number_schedule_and_timesheet_text

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-10-11 08:20:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Табельный номер и график работы - указываются при регистрации/оформлении
    # сотрудника (app/models/users.py).
    users_columns = [c['name'] for c in inspector.get_columns('users')]
    with op.batch_alter_table('users') as batch_op:
        if 'tab_number' not in users_columns:
            batch_op.add_column(sa.Column('tab_number', sa.String(), nullable=True))
        if 'work_schedule_hours' not in users_columns:
            batch_op.add_column(
                sa.Column('work_schedule_hours', sa.Numeric(precision=4, scale=2), nullable=True, server_default='8')
            )

    # Текстовая отметка в табеле вместо часов (например "Больничный лист",
    # "Отпуск") - app/models/timesheet.py.
    timesheet_columns = [c['name'] for c in inspector.get_columns('timesheet_entries')]
    if 'text_value' not in timesheet_columns:
        with op.batch_alter_table('timesheet_entries') as batch_op:
            batch_op.add_column(sa.Column('text_value', sa.String(length=100), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    timesheet_columns = [c['name'] for c in inspector.get_columns('timesheet_entries')]
    if 'text_value' in timesheet_columns:
        with op.batch_alter_table('timesheet_entries') as batch_op:
            batch_op.drop_column('text_value')

    users_columns = [c['name'] for c in inspector.get_columns('users')]
    with op.batch_alter_table('users') as batch_op:
        if 'work_schedule_hours' in users_columns:
            batch_op.drop_column('work_schedule_hours')
        if 'tab_number' in users_columns:
            batch_op.drop_column('tab_number')
