"""force_add_client_id_if_missing

Revision ID: 19b5f06206ac
Revises: 2abe263415bf
Create Date: 2026-03-01 16:04:21.914375

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '19b5f06206ac'
down_revision: Union[str, Sequence[str], None] = '2abe263415bf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    columns = [c['name'] for c in sa.inspect(conn).get_columns('chat_messages')]
    if 'client_id' not in columns:
        with op.batch_alter_table('chat_messages', schema=None) as batch_op:
            batch_op.add_column(sa.Column('client_id', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('chat_messages', schema=None) as batch_op:
        batch_op.drop_column('client_id')
