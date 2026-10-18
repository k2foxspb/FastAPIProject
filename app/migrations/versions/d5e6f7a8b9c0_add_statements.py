"""add_statements

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-10-18 20:40:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, Sequence[str], None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    # Свободное заявление сотрудника с текстом сообщения и согласованием
    # вышестоящими руководителями (app/models/statements.py: Statement).
    if 'statements' not in existing_tables:
        op.create_table(
            'statements',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('author_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('message', sa.Text(), nullable=False),
            sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
            sa.Column('reviewer_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('reviewer_comment', sa.Text(), nullable=True),
            sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column(
                'updated_at', sa.DateTime(timezone=True),
                server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False,
            ),
        )

    # Согласующие/уведомляемые по заявлению - все обязательные согласующие
    # должны согласовать, отказ любого отклоняет заявление целиком
    # (app/models/statements.py: StatementApproval).
    if 'statement_approvals' not in existing_tables:
        op.create_table(
            'statement_approvals',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('statement_id', sa.Integer(), sa.ForeignKey('statements.id', ondelete='CASCADE'), nullable=False),
            sa.Column('approver_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
            sa.Column('comment', sa.Text(), nullable=True),
            sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    if 'statement_approvals' in existing_tables:
        op.drop_table('statement_approvals')
    if 'statements' in existing_tables:
        op.drop_table('statements')
