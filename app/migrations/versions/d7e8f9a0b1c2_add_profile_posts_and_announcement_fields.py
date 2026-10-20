"""add_profile_posts_and_announcement_fields

Revision ID: d7e8f9a0b1c2
Revises: c5d6e7f8a9b0
Create Date: 2026-10-20 14:40:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd7e8f9a0b1c2'
down_revision: Union[str, Sequence[str], None] = 'c5d6e7f8a9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    # 1. Update announcements table if columns are missing
    if 'announcements' in existing_tables:
        existing_columns = [col['name'] for col in inspector.get_columns('announcements')]
        if 'priority' not in existing_columns:
            op.add_column('announcements', sa.Column('priority', sa.String(length=20), server_default='normal', nullable=False))
        if 'target_type' not in existing_columns:
            op.add_column('announcements', sa.Column('target_type', sa.String(length=50), nullable=True))
        if 'target_workshop_id' not in existing_columns:
            op.add_column('announcements', sa.Column('target_workshop_id', sa.Integer(), sa.ForeignKey('workshops.id', ondelete='SET NULL'), nullable=True))
        if 'target_section_id' not in existing_columns:
            op.add_column('announcements', sa.Column('target_section_id', sa.Integer(), sa.ForeignKey('sections.id', ondelete='SET NULL'), nullable=True))
        if 'target_role' not in existing_columns:
            op.add_column('announcements', sa.Column('target_role', sa.String(length=50), nullable=True))
        if 'expires_at' not in existing_columns:
            op.add_column('announcements', sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True))
        if 'is_active' not in existing_columns:
            op.add_column('announcements', sa.Column('is_active', sa.Boolean(), server_default=sa.true(), nullable=False))

    # 2. Update announcement_recipients table
    if 'announcement_recipients' in existing_tables:
        existing_recipient_cols = [col['name'] for col in inspector.get_columns('announcement_recipients')]
        if 'read_at' not in existing_recipient_cols:
            op.add_column('announcement_recipients', sa.Column('read_at', sa.DateTime(timezone=True), nullable=True))
        if 'delivered_at' not in existing_recipient_cols:
            op.add_column('announcement_recipients', sa.Column('delivered_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))

    # 3. Create profile_posts
    if 'profile_posts' not in existing_tables:
        op.create_table(
            'profile_posts',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('content', sa.Text(), nullable=True),
            sa.Column('media_url', sa.String(length=500), nullable=True),
            sa.Column('media_type', sa.String(length=50), nullable=True),
            sa.Column('privacy', sa.String(length=20), server_default='public', nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('is_active', sa.Boolean(), server_default=sa.true(), nullable=False),
        )
        op.create_index('ix_profile_posts_id', 'profile_posts', ['id'])
        op.create_index('ix_profile_posts_user_id', 'profile_posts', ['user_id'])
        op.create_index('ix_profile_posts_is_active', 'profile_posts', ['is_active'])

    # 4. Create profile_post_comments
    if 'profile_post_comments' not in existing_tables:
        op.create_table(
            'profile_post_comments',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('post_id', sa.Integer(), sa.ForeignKey('profile_posts.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('comment', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index('ix_profile_post_comments_id', 'profile_post_comments', ['id'])
        op.create_index('ix_profile_post_comments_post_id', 'profile_post_comments', ['post_id'])
        op.create_index('ix_profile_post_comments_user_id', 'profile_post_comments', ['user_id'])

    # 5. Create profile_post_reactions
    if 'profile_post_reactions' not in existing_tables:
        op.create_table(
            'profile_post_reactions',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('post_id', sa.Integer(), sa.ForeignKey('profile_posts.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('reaction_type', sa.String(length=50), nullable=False),
            sa.UniqueConstraint('post_id', 'user_id', name='uq_profile_post_reactions_post_user'),
        )
        op.create_index('ix_profile_post_reactions_id', 'profile_post_reactions', ['id'])
        op.create_index('ix_profile_post_reactions_post_id', 'profile_post_reactions', ['post_id'])
        op.create_index('ix_profile_post_reactions_user_id', 'profile_post_reactions', ['user_id'])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    if 'profile_post_reactions' in existing_tables:
        op.drop_table('profile_post_reactions')
    if 'profile_post_comments' in existing_tables:
        op.drop_table('profile_post_comments')
    if 'profile_posts' in existing_tables:
        op.drop_table('profile_posts')
