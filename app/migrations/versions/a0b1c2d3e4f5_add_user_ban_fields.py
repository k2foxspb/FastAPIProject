"""add_user_ban_fields

Добавляет в users поля для блокировки пользователя (временной или навсегда)
с возможностью восстановления:
- is_banned        - флаг блокировки;
- ban_reason       - причина блокировки (опционально);
- banned_until     - момент окончания временной блокировки (NULL = навсегда);
- banned_at        - момент, когда была наложена блокировка;
- banned_by_id     - кто заблокировал (администратор/владелец).

Revision ID: a0b1c2d3e4f5
Revises: f8a9b0c1d2e3
Create Date: 2026-10-31 18:20:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a0b1c2d3e4f5'
down_revision: Union[str, Sequence[str], None] = 'f8a9b0c1d2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    users_columns = [c['name'] for c in inspector.get_columns('users')]

    with op.batch_alter_table('users') as batch_op:
        if 'is_banned' not in users_columns:
            batch_op.add_column(
                sa.Column('is_banned', sa.Boolean(), nullable=False, server_default=sa.false())
            )
        if 'ban_reason' not in users_columns:
            batch_op.add_column(sa.Column('ban_reason', sa.String(), nullable=True))
        if 'banned_until' not in users_columns:
            batch_op.add_column(sa.Column('banned_until', sa.DateTime(timezone=True), nullable=True))
        if 'banned_at' not in users_columns:
            batch_op.add_column(sa.Column('banned_at', sa.DateTime(timezone=True), nullable=True))
        if 'banned_by_id' not in users_columns:
            batch_op.add_column(
                sa.Column('banned_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    users_columns = [c['name'] for c in inspector.get_columns('users')]

    with op.batch_alter_table('users') as batch_op:
        if 'banned_by_id' in users_columns:
            batch_op.drop_column('banned_by_id')
        if 'banned_at' in users_columns:
            batch_op.drop_column('banned_at')
        if 'banned_until' in users_columns:
            batch_op.drop_column('banned_until')
        if 'ban_reason' in users_columns:
            batch_op.drop_column('ban_reason')
        if 'is_banned' in users_columns:
            batch_op.drop_column('is_banned')
