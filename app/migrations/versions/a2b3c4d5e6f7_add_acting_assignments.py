"""add_acting_assignments

Revision ID: a2b3c4d5e6f7
Revises: e6f7a8b9c0d1
Create Date: 2026-10-19 17:10:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, Sequence[str], None] = 'e6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    # Временное назначение исполняющего обязанности (и.о.) ДОЛЖНОСТИ другого
    # сотрудника (app/models/structure.py: ActingAssignment). Замещается
    # именно должность - acting_role/acting_workshop_id/acting_section_id
    # являются снимком замещаемой должности на момент создания назначения,
    # поэтому последующее изменение должности replaced_user не влияет на уже
    # выданные права и.о.
    if 'acting_assignments' not in existing_tables:
        op.create_table(
            'acting_assignments',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('replaced_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('acting_role', sa.String(length=50), nullable=False),
            sa.Column('acting_workshop_id', sa.Integer(), sa.ForeignKey('workshops.id', ondelete='SET NULL'), nullable=True),
            sa.Column('acting_section_id', sa.Integer(), sa.ForeignKey('sections.id', ondelete='SET NULL'), nullable=True),
            sa.Column('assigned_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index('ix_acting_assignments_user_id', 'acting_assignments', ['user_id'])
        op.create_index('ix_acting_assignments_is_active', 'acting_assignments', ['is_active'])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    if 'acting_assignments' in existing_tables:
        op.drop_index('ix_acting_assignments_is_active', table_name='acting_assignments')
        op.drop_index('ix_acting_assignments_user_id', table_name='acting_assignments')
        op.drop_table('acting_assignments')
