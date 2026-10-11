"""add_icon_to_positions

Revision ID: a1b2c3d4e5f7
Revises: f6a7b8c9d0e1
Create Date: 2026-10-11 21:40:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, Sequence[str], None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Должности получают поле icon (имя иконки из набора Ionicons), которая
# отображается рядом с должностью в админке и в профиле пользователя,
# занимающего эту должность. По умолчанию - нейтральная иконка "person".
def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {c["name"] for c in inspector.get_columns("positions")}
    if "icon" not in columns:
        op.add_column(
            "positions",
            sa.Column("icon", sa.String(length=50), nullable=False, server_default="person"),
        )
        with op.batch_alter_table("positions") as batch_op:
            batch_op.alter_column("icon", server_default=None)

    icon_by_code = {
        "owner": "ribbon",
        "shop_chief": "business",
        "section_chief": "briefcase",
        "master": "construct",
        "assistant_master": "hammer",
        "worker": "hardware-chip",
    }
    for code, icon in icon_by_code.items():
        op.execute(sa.text("UPDATE positions SET icon = :icon WHERE code = :code").bindparams(icon=icon, code=code))


def downgrade() -> None:
    op.drop_column("positions", "icon")
