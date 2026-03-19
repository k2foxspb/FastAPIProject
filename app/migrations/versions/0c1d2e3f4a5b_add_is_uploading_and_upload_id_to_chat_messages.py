"""
add is_uploading and upload_id to chat_messages

Revision ID: 0c1d2e3f4a5b
Revises: 3227063fd916
Create Date: 2026-03-19 14:05:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0c1d2e3f4a5b'
down_revision = '3227063fd916'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use batch_alter_table for better compatibility across SQLite/PostgreSQL
    with op.batch_alter_table('chat_messages', schema=None) as batch_op:
        # server_default as false, will be removed after for PostgreSQL
        batch_op.add_column(sa.Column('is_uploading', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('upload_id', sa.String(), nullable=True))

    # Drop server_default for PostgreSQL so future inserts rely on application defaults
    try:
        with op.batch_alter_table('chat_messages', schema=None) as batch_op:
            batch_op.alter_column('is_uploading', server_default=None)
    except Exception:
        # On SQLite NO-OP
        pass


def downgrade() -> None:
    with op.batch_alter_table('chat_messages', schema=None) as batch_op:
        batch_op.drop_column('upload_id')
        batch_op.drop_column('is_uploading')
