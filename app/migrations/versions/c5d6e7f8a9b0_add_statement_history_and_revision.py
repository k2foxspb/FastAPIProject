"""add_statement_history_and_revision

Revision ID: c5d6e7f8a9b0
Revises: b3c4d5e6f7a8
Create Date: 2026-10-20 08:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c5d6e7f8a9b0'
down_revision: Union[str, Sequence[str], None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    if 'statements' in existing_tables:
        statement_columns = {c['name'] for c in inspector.get_columns('statements')}
        if 'round' not in statement_columns:
            op.add_column(
                'statements',
                sa.Column('round', sa.Integer(), nullable=False, server_default='1'),
            )

    if 'statement_audit_logs' not in existing_tables:
        op.create_table(
            'statement_audit_logs',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('statement_id', sa.Integer(), sa.ForeignKey('statements.id', ondelete='CASCADE'), nullable=False),
            sa.Column('round', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('actor_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('action', sa.String(length=50), nullable=False),
            sa.Column('resubmit_mode', sa.String(length=30), nullable=True),
            sa.Column('comment', sa.Text(), nullable=True),
            sa.Column('message_snapshot', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    if 'statement_audit_logs' in existing_tables:
        op.drop_table('statement_audit_logs')

    if 'statements' in existing_tables:
        statement_columns = {c['name'] for c in inspector.get_columns('statements')}
        if 'round' in statement_columns:
            op.drop_column('statements', 'round')
