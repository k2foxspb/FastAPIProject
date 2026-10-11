"""add_timesheet_and_production

Revision ID: c3d4e5f6a7b8
Revises: b1c2d3e4f5a6
Create Date: 2026-10-11 06:40:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    if 'timesheet_entries' not in existing_tables:
        op.create_table(
            'timesheet_entries',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('date', sa.Date(), nullable=False),
            sa.Column('hours', sa.Numeric(precision=5, scale=2), nullable=False, server_default='0'),
            sa.Column('comment', sa.String(), nullable=True),
            sa.Column('created_by_id', sa.Integer(), nullable=True),
            sa.Column('updated_by_id', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id', 'date', name='uq_timesheet_entries_user_date'),
        )

    existing_tables = inspector.get_table_names()
    if 'production_products' not in existing_tables:
        op.create_table(
            'production_products',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(length=200), nullable=False),
            sa.Column('code', sa.String(length=100), nullable=True),
            sa.Column('unit', sa.String(length=50), nullable=False, server_default='шт'),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('code', name='uq_production_products_code'),
        )

    existing_tables = inspector.get_table_names()
    if 'production_entries' not in existing_tables:
        op.create_table(
            'production_entries',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('date', sa.Date(), nullable=False),
            sa.Column('status', sa.String(length=20), nullable=False, server_default='draft'),
            sa.Column('reviewer_id', sa.Integer(), nullable=True),
            sa.Column('reviewer_comment', sa.Text(), nullable=True),
            sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['reviewer_id'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id', 'date', name='uq_production_entries_user_date'),
        )

    existing_tables = inspector.get_table_names()
    if 'production_entry_items' not in existing_tables:
        op.create_table(
            'production_entry_items',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('entry_id', sa.Integer(), nullable=False),
            sa.Column('product_id', sa.Integer(), nullable=False),
            sa.Column('quantity', sa.Numeric(precision=10, scale=2), nullable=False, server_default='0'),
            sa.Column('comment', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(['entry_id'], ['production_entries.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['product_id'], ['production_products.id'], ondelete='RESTRICT'),
            sa.PrimaryKeyConstraint('id'),
        )

    existing_tables = inspector.get_table_names()
    if 'production_audit_logs' not in existing_tables:
        op.create_table(
            'production_audit_logs',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('entry_id', sa.Integer(), nullable=False),
            sa.Column('actor_id', sa.Integer(), nullable=True),
            sa.Column('action', sa.String(length=30), nullable=False),
            sa.Column('comment', sa.Text(), nullable=True),
            sa.Column('old_values', sa.JSON(), nullable=True),
            sa.Column('new_values', sa.JSON(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(['entry_id'], ['production_entries.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )


def downgrade() -> None:
    op.drop_table('production_audit_logs')
    op.drop_table('production_entry_items')
    op.drop_table('production_entries')
    op.drop_table('production_products')
    op.drop_table('timesheet_entries')
