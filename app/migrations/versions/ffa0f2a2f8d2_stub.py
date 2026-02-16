"""empty migration to restore chain
Revision ID: ffa0f2a2f8d2
Revises: d0c318246b7b
Create Date: 2026-02-16 12:45:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'ffa0f2a2f8d2'
down_revision: Union[str, Sequence[str], None] = 'd0c318246b7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    pass



def downgrade() -> None:
    pass
