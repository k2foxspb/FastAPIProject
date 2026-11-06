"""encrypt_chat_messages

Перешифровывает существующие сообщения чата (message, comment), которые лежат в открытом виде.
Шифрование на стороне сервера выполняется ключом CHAT_ENCRYPTION_KEY из .env.

Revision ID: m1a0b1c2d3e4
Revises: l1a0b1c2d3e4
Create Date: 2026-11-06 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.core.message_crypto import encrypt_text, decrypt_text, is_encrypted


revision: str = "m1a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "l1a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_BATCH_SIZE = 500
_COLUMNS = ("message", "comment")


def _transform_column(transform, column: str) -> None:
    bind = op.get_bind()
    table = sa.table(
        "chat_messages",
        sa.column("id", sa.Integer),
        sa.column(column, sa.String),
    )
    last_id = 0
    while True:
        rows = bind.execute(
            sa.select(table.c.id, table.c[column])
            .where(table.c.id > last_id)
            .where(table.c[column].isnot(None))
            .order_by(table.c.id)
            .limit(_BATCH_SIZE)
        ).all()
        if not rows:
            break
        for row_id, value in rows:
            new_value = transform(value)
            if new_value != value:
                bind.execute(
                    table.update().where(table.c.id == row_id).values({column: new_value})
                )
        last_id = rows[-1][0]


def upgrade() -> None:
    for column in _COLUMNS:
        _transform_column(lambda v: v if is_encrypted(v) else encrypt_text(v), column)


def downgrade() -> None:
    for column in _COLUMNS:
        _transform_column(lambda v: decrypt_text(v) if is_encrypted(v) else v, column)
