"""add_privacy_to_user_photos

Revision ID: a1b2c3d4e5f6
Revises: efad89f31169
Create Date: 2026-02-19 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'efad89f31169'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add missing column `privacy` to `user_photos` if it does not exist."""
    # Use a safe conditional DDL for PostgreSQL to avoid failures if the column already exists
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = 'user_photos'
                      AND column_name = 'privacy'
                ) THEN
                    ALTER TABLE user_photos
                    ADD COLUMN privacy VARCHAR NOT NULL DEFAULT 'public';
                END IF;
            END;
            $$;
            """
        )
    )


def downgrade() -> None:
    """Remove column `privacy` from `user_photos` if it exists."""
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = 'user_photos'
                      AND column_name = 'privacy'
                ) THEN
                    ALTER TABLE user_photos
                    DROP COLUMN privacy;
                END IF;
            END;
            $$;
            """
        )
    )
