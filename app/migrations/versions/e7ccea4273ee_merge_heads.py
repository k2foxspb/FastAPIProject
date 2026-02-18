"""merge heads

Revision ID: e7ccea4273ee
Revises: 3f9c1a2d7e41, 6f7b1e8a9c2d
Create Date: 2026-02-18 12:40:16.789618

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7ccea4273ee'
down_revision: Union[str, Sequence[str], None] = ('3f9c1a2d7e41', '6f7b1e8a9c2d')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
