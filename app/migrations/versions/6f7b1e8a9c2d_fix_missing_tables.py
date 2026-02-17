"""fix missing tables and columns

Revision ID: 6f7b1e8a9c2d
Revises: ffa0f2a2f8d2
Create Date: 2026-02-17 08:50:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = '6f7b1e8a9c2d'
down_revision: Union[str, Sequence[str], None] = 'ffa0f2a2f8d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    insp = inspect(bind)
    return table_name in insp.get_table_names()


def upgrade() -> None:
    # 1. Create news_images table
    if not _table_exists("news_images"):
        op.create_table('news_images',
                        sa.Column('id', sa.Integer(), nullable=False),
                        sa.Column('news_id', sa.Integer(), nullable=False),
                        sa.Column('image_url', sa.String(length=200), nullable=False),
                        sa.Column('thumbnail_url', sa.String(length=200), nullable=False),
                        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'),
                                  nullable=False),
                        sa.ForeignKeyConstraint(['news_id'], ['news.id'], ondelete='CASCADE'),
                        sa.PrimaryKeyConstraint('id')
                        )

    # 2. Create product_images table
    if not _table_exists("product_images"):
        op.create_table('product_images',
                        sa.Column('id', sa.Integer(), nullable=False),
                        sa.Column('product_id', sa.Integer(), nullable=False),
                        sa.Column('image_url', sa.String(length=200), nullable=False),
                        sa.Column('thumbnail_url', sa.String(length=200), nullable=False),
                        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'),
                                  nullable=False),
                        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='CASCADE'),
                        sa.PrimaryKeyConstraint('id')
                        )

    # 3. Fix moderation_status in products (it might have failed to apply or be null)
    # Since we can't easily check if it exists without try/except in SQL, 
    # we'll use a safe approach if we assume the previous migration might have partially failed or needs a default.
    # If it already exists and is not null, this is safe.
    op.execute("UPDATE products SET moderation_status = 'approved' WHERE moderation_status IS NULL")

    # 4. Ensure is_active in news has a default
    op.execute("UPDATE news SET is_active = true WHERE is_active IS NULL")


def downgrade() -> None:
    # Откатываем только если таблицы действительно есть
    if _table_exists("product_images"):
        op.drop_table("product_images")
    if _table_exists("news_images"):
        op.drop_table("news_images")