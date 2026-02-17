"""expand_url_columns_for_s3

Revision ID: b2e1a7c9b8f3
Revises: ffa0f2a2f8d2
Create Date: 2026-02-17 22:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b2e1a7c9b8f3'
down_revision: Union[str, Sequence[str], None] = 'ffa0f2a2f8d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Увеличить длину URL-полей для совместимости с публичными S3/Yandex ссылками."""
    # news
    op.alter_column('news', 'image_url', type_=sa.Text(), existing_type=sa.String(length=200), existing_nullable=True)
    op.alter_column('news_images', 'image_url', type_=sa.Text(), existing_type=sa.String(length=200), existing_nullable=False)
    op.alter_column('news_images', 'thumbnail_url', type_=sa.Text(), existing_type=sa.String(length=200), existing_nullable=False)
    
    # products
    op.alter_column('products', 'image_url', type_=sa.Text(), existing_type=sa.String(length=200), existing_nullable=True)
    op.alter_column('products', 'thumbnail_url', type_=sa.Text(), existing_type=sa.String(length=200), existing_nullable=True)
    op.alter_column('product_images', 'image_url', type_=sa.Text(), existing_type=sa.String(length=200), existing_nullable=False)
    op.alter_column('product_images', 'thumbnail_url', type_=sa.Text(), existing_type=sa.String(length=200), existing_nullable=False)


def downgrade() -> None:
    """Откатить изменения типов URL-полей к исходным String(200)."""
    # news
    op.alter_column('news', 'image_url', type_=sa.String(length=200), existing_type=sa.Text(), existing_nullable=True)
    op.alter_column('news_images', 'image_url', type_=sa.String(length=200), existing_type=sa.Text(), existing_nullable=False)
    op.alter_column('news_images', 'thumbnail_url', type_=sa.String(length=200), existing_type=sa.Text(), existing_nullable=False)
    
    # products
    op.alter_column('products', 'image_url', type_=sa.String(length=200), existing_type=sa.Text(), existing_nullable=True)
    op.alter_column('products', 'thumbnail_url', type_=sa.String(length=200), existing_type=sa.Text(), existing_nullable=True)
    op.alter_column('product_images', 'image_url', type_=sa.String(length=200), existing_type=sa.Text(), existing_nullable=False)
    op.alter_column('product_images', 'thumbnail_url', type_=sa.String(length=200), existing_type=sa.Text(), existing_nullable=False)
