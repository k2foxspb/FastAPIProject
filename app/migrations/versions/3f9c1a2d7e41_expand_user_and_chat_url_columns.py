"""expand_user_and_chat_url_columns

Revision ID: 3f9c1a2d7e41
Revises: b2e1a7c9b8f3
Create Date: 2026-02-17 22:25:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '3f9c1a2d7e41'
down_revision: Union[str, Sequence[str], None] = 'b2e1a7c9b8f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Расширение URL/путей в таблицах пользователей и чата для совместимости с длинными публичными ссылками S3/YC."""
    # users: аватары
    op.alter_column('users', 'avatar_url', type_=sa.Text(), existing_type=sa.String(), existing_nullable=True)
    op.alter_column('users', 'avatar_preview_url', type_=sa.Text(), existing_type=sa.String(), existing_nullable=True)

    # user_photos: ссылки на изображения и превью
    op.alter_column('user_photos', 'image_url', type_=sa.Text(), existing_type=sa.String(), existing_nullable=False)
    op.alter_column('user_photos', 'preview_url', type_=sa.Text(), existing_type=sa.String(), existing_nullable=False)

    # chat_messages: путь к файлу сообщения
    op.alter_column('chat_messages', 'file_path', type_=sa.Text(), existing_type=sa.String(), existing_nullable=True)


def downgrade() -> None:
    """Откат расширений к типу String (без длины)."""
    # users: аватары
    op.alter_column('users', 'avatar_url', type_=sa.String(), existing_type=sa.Text(), existing_nullable=True)
    op.alter_column('users', 'avatar_preview_url', type_=sa.String(), existing_type=sa.Text(), existing_nullable=True)

    # user_photos
    op.alter_column('user_photos', 'image_url', type_=sa.String(), existing_type=sa.Text(), existing_nullable=False)
    op.alter_column('user_photos', 'preview_url', type_=sa.String(), existing_type=sa.Text(), existing_nullable=False)

    # chat_messages
    op.alter_column('chat_messages', 'file_path', type_=sa.String(), existing_type=sa.Text(), existing_nullable=True)
