"""Placeholder migration – original file lost"""

from alembic import op
import sqlalchemy as sa

revision = "5c357d961c67"
down_revision = "d0c318246b7b"         # ← сейчас это ошибка
branch_labels = None
depends_on = None

def upgrade():
    pass

def downgrade():
    pass
