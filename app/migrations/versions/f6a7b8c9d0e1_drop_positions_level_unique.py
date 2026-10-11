"""drop_positions_level_unique

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-10-11 21:20:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Должности "worker" как единственной фиксированной должности нижнего уровня
# больше не существует: на самом нижнем уровне иерархии (scope="self")
# теперь можно создать сколько угодно разных должностей с одним и тем же
# level (они равноправны и не управляют друг другом). Для этого снимаем
# ограничение уникальности с поля level. Также снимаем системную отметку
# с должности "worker" - теперь это обычная должность, которую можно
# переименовать или удалить, если сотрудников с ней не осталось.
def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_constraints = {c["name"] for c in inspector.get_unique_constraints("positions")}
    if "uq_positions_level" in existing_constraints:
        with op.batch_alter_table("positions") as batch_op:
            batch_op.drop_constraint("uq_positions_level", type_="unique")

    op.execute(sa.text("UPDATE positions SET is_system = false WHERE code = 'worker'"))


def downgrade() -> None:
    with op.batch_alter_table("positions") as batch_op:
        batch_op.create_unique_constraint("uq_positions_level", ["level"])
    op.execute(sa.text("UPDATE positions SET is_system = true WHERE code = 'worker'"))
