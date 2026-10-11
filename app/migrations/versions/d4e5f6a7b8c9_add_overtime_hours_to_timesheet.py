"""add_overtime_hours_to_timesheet

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-10-11 07:40:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = [c['name'] for c in inspector.get_columns('timesheet_entries')]

    if 'overtime_hours' not in existing_columns:
        with op.batch_alter_table('timesheet_entries') as batch_op:
            batch_op.add_column(
                sa.Column('overtime_hours', sa.Numeric(precision=5, scale=2), nullable=False, server_default='0')
            )

        timesheet_entries = sa.table(
            'timesheet_entries',
            sa.column('hours', sa.Numeric(precision=5, scale=2)),
            sa.column('overtime_hours', sa.Numeric(precision=5, scale=2)),
        )
        # Переносим исторические данные: ранее "основное"/"сверхурочное"
        # высчитывались на лету по норме 8 часов из единого поля hours -
        # сохраняем то же самое разбиение явно, чтобы отображение старых
        # записей не изменилось.
        norm = 8
        bind.execute(
            timesheet_entries.update().values(
                overtime_hours=sa.case((timesheet_entries.c.hours > norm, timesheet_entries.c.hours - norm), else_=0),
                hours=sa.case((timesheet_entries.c.hours > norm, norm), else_=timesheet_entries.c.hours),
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = [c['name'] for c in inspector.get_columns('timesheet_entries')]
    if 'overtime_hours' in existing_columns:
        timesheet_entries = sa.table(
            'timesheet_entries',
            sa.column('hours', sa.Numeric(precision=5, scale=2)),
            sa.column('overtime_hours', sa.Numeric(precision=5, scale=2)),
        )
        bind.execute(
            timesheet_entries.update().values(hours=timesheet_entries.c.hours + timesheet_entries.c.overtime_hours)
        )
        with op.batch_alter_table('timesheet_entries') as batch_op:
            batch_op.drop_column('overtime_hours')
