"""add_timesheet_multi_approval

Revision ID: c4d5e6f7a8b9
Revises: f7a8b9c0d1e2
Create Date: 2026-10-18 20:15:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, Sequence[str], None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Номер раунда согласования - app/models/timesheet.py: TimesheetEntry.approval_round.
    columns = [c['name'] for c in inspector.get_columns('timesheet_entries')]
    with op.batch_alter_table('timesheet_entries') as batch_op:
        if 'approval_round' not in columns:
            batch_op.add_column(
                sa.Column('approval_round', sa.Integer(), nullable=False, server_default='0')
            )

    # Несколько обязательных согласующих на раунд - все должны согласовать,
    # отказ любого отклоняет изменение целиком (app/models/timesheet.py: TimesheetEntryApproval).
    existing_tables = inspector.get_table_names()
    if 'timesheet_entry_approvals' not in existing_tables:
        op.create_table(
            'timesheet_entry_approvals',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('entry_id', sa.Integer(), sa.ForeignKey('timesheet_entries.id', ondelete='CASCADE'), nullable=False),
            sa.Column('round', sa.Integer(), nullable=False),
            sa.Column('approver_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
            sa.Column('comment', sa.Text(), nullable=True),
            sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    # Журнал событий табеля (отправка/повторная отправка/правка руководителем) -
    # открывает новый раунд, используется для истории карточки дня (app/models/timesheet.py: TimesheetAuditLog).
    if 'timesheet_audit_logs' not in existing_tables:
        op.create_table(
            'timesheet_audit_logs',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('entry_id', sa.Integer(), sa.ForeignKey('timesheet_entries.id', ondelete='CASCADE'), nullable=False),
            sa.Column('round', sa.Integer(), nullable=False),
            sa.Column('actor_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('action', sa.String(length=30), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    if 'timesheet_audit_logs' in existing_tables:
        op.drop_table('timesheet_audit_logs')
    if 'timesheet_entry_approvals' in existing_tables:
        op.drop_table('timesheet_entry_approvals')

    columns = [c['name'] for c in inspector.get_columns('timesheet_entries')]
    with op.batch_alter_table('timesheet_entries') as batch_op:
        if 'approval_round' in columns:
            batch_op.drop_column('approval_round')
