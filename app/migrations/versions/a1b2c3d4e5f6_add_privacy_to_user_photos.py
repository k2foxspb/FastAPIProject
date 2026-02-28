"""add_privacy_to_user_photos

Revision ID: a1b2c3d4e5f6
Revises: efad89f31169
Create Date: 2026-02-19 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'efad89f31169'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add missing column `privacy` to `user_photos` if it does not exist."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = [c['name'] for c in inspector.get_columns('user_photos')]
    
    if 'privacy' not in columns:
        op.add_column('user_photos', sa.Column('privacy', sa.String(), nullable=False, server_default='public'))


def downgrade() -> None:
    """Remove column `privacy` from `user_photos` if it exists."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = [c['name'] for c in inspector.get_columns('user_photos')]
    
    if 'privacy' in columns:
        op.drop_column('user_photos', 'privacy')
