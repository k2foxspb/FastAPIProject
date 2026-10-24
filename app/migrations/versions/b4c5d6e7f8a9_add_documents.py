"""add_documents

Revision ID: b4c5d6e7f8a9
Revises: a9b1c2d3e4f5
Create Date: 2026-10-24 07:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4c5d6e7f8a9'
down_revision: Union[str, Sequence[str], None] = 'a9b1c2d3e4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    # Категории документов (папки) - app/models/documents.py:DocumentCategory
    if 'document_categories' not in existing_tables:
        op.create_table(
            'document_categories',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('title', sa.String(length=200), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column(
                'updated_at', sa.DateTime(timezone=True),
                server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False,
            ),
        )

    # Документ для ознакомления, с опциональным согласованием подписантами -
    # app/models/documents.py:Document
    if 'documents' not in existing_tables:
        op.create_table(
            'documents',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('category_id', sa.Integer(), sa.ForeignKey('document_categories.id', ondelete='CASCADE'), nullable=False),
            sa.Column('title', sa.String(length=300), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('file_url', sa.String(length=500), nullable=True),
            sa.Column('file_key', sa.String(length=500), nullable=True),
            sa.Column('content', sa.Text(), nullable=True),
            sa.Column('confirmation_button_text', sa.String(length=100), nullable=False, server_default='Ознакомлен'),
            sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('status', sa.String(length=30), nullable=False, server_default='draft'),
            sa.Column('approval_required', sa.Boolean(), nullable=False, server_default='0'),
            sa.Column('approval_started_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('approval_completed_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('rejected_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column(
                'updated_at', sa.DateTime(timezone=True),
                server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False,
            ),
        )

    # Решения подписантов по версии документа - app/models/documents.py:DocumentApproval
    if 'document_approvals' not in existing_tables:
        op.create_table(
            'document_approvals',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('document_id', sa.Integer(), sa.ForeignKey('documents.id', ondelete='CASCADE'), nullable=False),
            sa.Column('approver_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('document_version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
            sa.Column('comment', sa.Text(), nullable=True),
            sa.Column('requested_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('rejected_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('last_reminder_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column(
                'updated_at', sa.DateTime(timezone=True),
                server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False,
            ),
            sa.UniqueConstraint(
                'document_id', 'approver_user_id', 'document_version',
                name='uq_document_approvals_doc_approver_version',
            ),
        )

    # Назначения документа на ознакомление пользователям - app/models/documents.py:DocumentAssignment
    if 'document_assignments' not in existing_tables:
        op.create_table(
            'document_assignments',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('document_id', sa.Integer(), sa.ForeignKey('documents.id', ondelete='CASCADE'), nullable=False),
            sa.Column('assigned_to_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('assigned_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('target_type', sa.String(length=20), nullable=False, server_default='user'),
            sa.Column('target_id', sa.Integer(), nullable=True),
            sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
            sa.Column('assigned_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('last_reminder_at', sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint('document_id', 'assigned_to_user_id', name='uq_document_assignments_doc_user'),
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    if 'document_assignments' in existing_tables:
        op.drop_table('document_assignments')
    if 'document_approvals' in existing_tables:
        op.drop_table('document_approvals')
    if 'documents' in existing_tables:
        op.drop_table('documents')
    if 'document_categories' in existing_tables:
        op.drop_table('document_categories')
