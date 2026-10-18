"""add_timesheet_approval_status

Revision ID: f7a8b9c0d1e2
Revises: a1b2c3d4e5f7
Create Date: 2026-10-18 19:50:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Согласование изменений табеля (часов) вышестоящим руководителем -
    # app/models/timesheet.py: TimesheetEntry.status/reviewer_id/
    # reviewer_comment/reviewed_at/submitted_at. По умолчанию - "approved",
    # чтобы все уже существующие записи считались согласованными.
    columns = [c['name'] for c in inspector.get_columns('timesheet_entries')]
    with op.batch_alter_table('timesheet_entries') as batch_op:
        if 'status' not in columns:
            batch_op.add_column(
                sa.Column('status', sa.String(length=20), nullable=False, server_default='approved')
            )
        if 'reviewer_id' not in columns:
            batch_op.add_column(sa.Column('reviewer_id', sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                'fk_timesheet_entries_reviewer_id_users', 'users', ['reviewer_id'], ['id'], ondelete='SET NULL'
            )
        if 'reviewer_comment' not in columns:
            batch_op.add_column(sa.Column('reviewer_comment', sa.Text(), nullable=True))
        if 'reviewed_at' not in columns:
            batch_op.add_column(sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True))
        if 'submitted_at' not in columns:
            batch_op.add_column(sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    columns = [c['name'] for c in inspector.get_columns('timesheet_entries')]
    with op.batch_alter_table('timesheet_entries') as batch_op:
        if 'submitted_at' in columns:
            batch_op.drop_column('submitted_at')
        if 'reviewed_at' in columns:
            batch_op.drop_column('reviewed_at')
        if 'reviewer_comment' in columns:
            batch_op.drop_column('reviewer_comment')
        if 'reviewer_id' in columns:
            batch_op.drop_constraint('fk_timesheet_entries_reviewer_id_users', type_='foreignkey')
            batch_op.drop_column('reviewer_id')
        if 'status' in columns:
            batch_op.drop_column('status')
