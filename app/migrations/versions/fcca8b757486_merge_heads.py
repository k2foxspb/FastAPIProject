"""merge heads

Revision ID: fcca8b757486
Revises: 26478491c4ad, 7d1ac5b4043a
Create Date: 2026-02-16 12:32:09.208446

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fcca8b757486'
down_revision: Union[str, Sequence[str], None] = ('26478491c4ad', '7d1ac5b4043a')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
