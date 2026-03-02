"""restore_missing_revision_bridge

Revision ID: af99037b0ab3
Revises: efad89f31169
Create Date: 2026-03-02 19:19:00.000000

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'af99037b0ab3'
down_revision: Union[str, Sequence[str], None] = 'efad89f31169'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Bridge revision.

    Эта миграция добавлена ретроспективно, чтобы Alembic мог продолжить работу
    с базами, восстановленными из бэкапа, где в таблице `alembic_version`
    записана ревизия `af99037b0ab3`, но файл миграции отсутствовал в репозитории.

    Схемных изменений не выполняет.
    """


def downgrade() -> None:
    """Downgrade bridge revision (no-op)."""
