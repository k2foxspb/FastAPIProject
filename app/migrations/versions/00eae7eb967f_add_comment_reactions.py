"""add_comment_reactions

Revision ID: 00eae7eb967f
Revises: 4a11d14e95a4
Create Date: 2026-02-21 18:29:41.432804

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '00eae7eb967f'
down_revision: Union[str, Sequence[str], None] = '4a11d14e95a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # news_comment_reactions
    op.create_table('news_comment_reactions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('comment_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('reaction_type', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['comment_id'], ['news_comments.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    
    # user_photo_comment_reactions
    op.create_table('user_photo_comment_reactions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('comment_id', sa.Integer(), nullable=False),
    sa.Column('reaction_type', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['comment_id'], ['user_photo_comments.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    
    # review_reactions
    op.create_table('review_reactions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('review_id', sa.Integer(), nullable=False),
    sa.Column('reaction_type', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['review_id'], ['reviews.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('review_reactions')
    op.drop_table('user_photo_comment_reactions')
    op.drop_table('news_comment_reactions')
