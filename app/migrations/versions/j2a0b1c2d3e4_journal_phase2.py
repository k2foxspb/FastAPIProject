"""journal_phase2

Журнал жизни, фаза 2 (диета): типы приёмов пищи, личная база продуктов и
рецептов, ингредиенты рецептов, записи о еде (снимок КБЖУ) и воде.

Revision ID: j2a0b1c2d3e4
Revises: j1a0b1c2d3e4
Create Date: 2026-11-01 09:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'j2a0b1c2d3e4'
down_revision: Union[str, Sequence[str], None] = 'j1a0b1c2d3e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BigIntPK = sa.BigInteger().with_variant(sa.Integer(), 'sqlite')


def _entity_columns(table: str) -> list:
    """Колонки и ограничения JournalEntityMixin."""
    return [
        sa.Column('id', BigIntPK, primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('client_uuid', sa.String(length=36), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('server_rev', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE',
                                name=f'fk_{table}_user_id_users'),
        sa.PrimaryKeyConstraint('id', name=f'pk_{table}'),
        sa.UniqueConstraint('user_id', 'client_uuid', name=f'uq_{table}_user_uuid'),
    ]


def _entity_indexes(table: str) -> None:
    op.create_index(f'ix_{table}_user_id', table, ['user_id'])
    op.create_index(f'ix_{table}_user_rev', table, ['user_id', 'server_rev'])


def upgrade() -> None:
    op.create_table(
        'journal_meal_types',
        *_entity_columns('journal_meal_types'),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('default_time', sa.Time(), nullable=True),
        sa.Column('icon', sa.String(length=50), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('reminder_enabled', sa.Boolean(), nullable=False),
    )
    _entity_indexes('journal_meal_types')

    op.create_table(
        'journal_foods',
        *_entity_columns('journal_foods'),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('brand', sa.String(length=100), nullable=True),
        sa.Column('kcal_100', sa.Numeric(8, 2), nullable=False),
        sa.Column('protein_100', sa.Numeric(8, 2), nullable=False),
        sa.Column('fat_100', sa.Numeric(8, 2), nullable=False),
        sa.Column('carbs_100', sa.Numeric(8, 2), nullable=False),
        sa.Column('serving_g', sa.Numeric(8, 2), nullable=True),
        sa.Column('barcode', sa.String(length=32), nullable=True),
        sa.Column('source', sa.String(length=10), nullable=False),
        sa.Column('is_recipe', sa.Boolean(), nullable=False),
        sa.Column('recipe_yield_g', sa.Numeric(8, 2), nullable=True),
        sa.Column('use_count', sa.Integer(), nullable=False),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    )
    _entity_indexes('journal_foods')
    op.create_index('ix_journal_foods_user_barcode', 'journal_foods', ['user_id', 'barcode'])

    op.create_table(
        'journal_recipe_items',
        *_entity_columns('journal_recipe_items'),
        sa.Column('recipe_id', BigIntPK, nullable=False),
        sa.Column('ingredient_id', BigIntPK, nullable=False),
        sa.Column('grams', sa.Numeric(8, 2), nullable=False),
        sa.ForeignKeyConstraint(['recipe_id'], ['journal_foods.id'], ondelete='CASCADE',
                                name='fk_journal_recipe_items_recipe_id_journal_foods'),
        sa.ForeignKeyConstraint(['ingredient_id'], ['journal_foods.id'], ondelete='CASCADE',
                                name='fk_journal_recipe_items_ingredient_id_journal_foods'),
    )
    _entity_indexes('journal_recipe_items')
    op.create_index('ix_journal_recipe_items_recipe_id', 'journal_recipe_items', ['recipe_id'])
    op.create_index('ix_journal_recipe_items_ingredient_id', 'journal_recipe_items', ['ingredient_id'])

    op.create_table(
        'journal_food_entries',
        *_entity_columns('journal_food_entries'),
        sa.Column('entry_date', sa.Date(), nullable=False),
        sa.Column('entry_time', sa.Time(), nullable=True),
        sa.Column('meal_type_id', BigIntPK, nullable=True),
        sa.Column('food_id', BigIntPK, nullable=True),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('grams', sa.Numeric(8, 2), nullable=False),
        sa.Column('kcal', sa.Numeric(10, 2), nullable=False),
        sa.Column('protein', sa.Numeric(10, 2), nullable=False),
        sa.Column('fat', sa.Numeric(10, 2), nullable=False),
        sa.Column('carbs', sa.Numeric(10, 2), nullable=False),
        sa.Column('note', sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(['meal_type_id'], ['journal_meal_types.id'], ondelete='SET NULL',
                                name='fk_journal_food_entries_meal_type_id_journal_meal_types'),
        sa.ForeignKeyConstraint(['food_id'], ['journal_foods.id'], ondelete='SET NULL',
                                name='fk_journal_food_entries_food_id_journal_foods'),
    )
    _entity_indexes('journal_food_entries')
    op.create_index('ix_journal_food_entries_user_date', 'journal_food_entries', ['user_id', 'entry_date'])
    op.create_index('ix_journal_food_entries_meal_type_id', 'journal_food_entries', ['meal_type_id'])
    op.create_index('ix_journal_food_entries_food_id', 'journal_food_entries', ['food_id'])

    op.create_table(
        'journal_water_entries',
        *_entity_columns('journal_water_entries'),
        sa.Column('entry_date', sa.Date(), nullable=False),
        sa.Column('entry_time', sa.Time(), nullable=False),
        sa.Column('amount_ml', sa.Integer(), nullable=False),
        sa.CheckConstraint('amount_ml >= 1 AND amount_ml <= 5000',
                           name='ck_journal_water_entries_amount_range'),
    )
    _entity_indexes('journal_water_entries')
    op.create_index('ix_journal_water_entries_user_date', 'journal_water_entries', ['user_id', 'entry_date'])


def downgrade() -> None:
    # Дети раньше родителей (FK)
    for table in (
        'journal_water_entries', 'journal_food_entries', 'journal_recipe_items', 'journal_foods',
        'journal_meal_types',
    ):
        op.drop_table(table)
