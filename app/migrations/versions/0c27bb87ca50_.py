"""empty message

Revision ID: 0c27bb87ca50
Revises: aa319fd5adc8
Create Date: 2026-02-13 20:09:05.660123

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0c27bb87ca50'
down_revision: Union[str, Sequence[str], None] = 'aa319fd5adc8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
