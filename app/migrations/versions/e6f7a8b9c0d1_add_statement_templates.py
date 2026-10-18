"""add_statement_templates

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-10-18 21:10:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e6f7a8b9c0d1'
down_revision: Union[str, Sequence[str], None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    # Шаблон заявления, настраиваемый администратором в админке - название,
    # необязательный текст по умолчанию и признак активности
    # (app/models/statements.py: StatementTemplate).
    if 'statement_templates' not in existing_tables:
        op.create_table(
            'statement_templates',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('name', sa.String(length=255), nullable=False),
            sa.Column('default_message', sa.Text(), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column(
                'updated_at', sa.DateTime(timezone=True),
                server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False,
            ),
        )

    # Обязательные согласующие и просто уведомляемые, закреплённые
    # администратором за шаблоном (app/models/statements.py: StatementTemplateRecipient).
    if 'statement_template_recipients' not in existing_tables:
        op.create_table(
            'statement_template_recipients',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('template_id', sa.Integer(), sa.ForeignKey('statement_templates.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('role', sa.String(length=20), nullable=False, server_default='approve'),
        )

    # Ссылка заявления на шаблон, по которому оно было создано
    # (app/models/statements.py: Statement.template_id).
    statement_columns = {c['name'] for c in inspector.get_columns('statements')} if 'statements' in existing_tables else set()
    if 'statements' in existing_tables and 'template_id' not in statement_columns:
        op.add_column(
            'statements',
            sa.Column('template_id', sa.Integer(), sa.ForeignKey('statement_templates.id', ondelete='SET NULL'), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    if 'statements' in existing_tables:
        statement_columns = {c['name'] for c in inspector.get_columns('statements')}
        if 'template_id' in statement_columns:
            op.drop_column('statements', 'template_id')

    if 'statement_template_recipients' in existing_tables:
        op.drop_table('statement_template_recipients')
    if 'statement_templates' in existing_tables:
        op.drop_table('statement_templates')
