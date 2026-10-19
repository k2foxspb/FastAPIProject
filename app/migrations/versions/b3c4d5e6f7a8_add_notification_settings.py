"""add_notification_settings

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-10-19 18:40:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = [c['name'] for c in inspector.get_columns('users')]

    # Настройки уведомлений пользователя (app/models/users.py: User.notification_settings):
    # отключённые группы оповещений (объявления, новости, чаты и т.д.) и
    # "тихие часы" (ночное время, когда уведомления приходят без звука).
    if 'notification_settings' not in existing_columns:
        op.add_column('users', sa.Column('notification_settings', sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = [c['name'] for c in inspector.get_columns('users')]

    if 'notification_settings' in existing_columns:
        op.drop_column('users', 'notification_settings')
