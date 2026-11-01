"""journal_phase1

Журнал жизни, фаза 1 (ядро): настройки, состояние синхронизации, события и
их исключения по датам, напоминания, дневник, пользовательские трекеры и их
значения, вложения. У всех сущностей: user_id (CASCADE), client_uuid
(уникален в паре с user_id), created_at/updated_at/deleted_at, server_rev.

Revision ID: j1a0b1c2d3e4
Revises: a0b1c2d3e4f5
Create Date: 2026-11-01 07:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'j1a0b1c2d3e4'
down_revision: Union[str, Sequence[str], None] = 'a0b1c2d3e4f5'
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
        'journal_sync_state',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('last_rev', sa.BigInteger(), nullable=False),
        sa.Column('purged_rev', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE',
                                name='fk_journal_sync_state_user_id_users'),
        sa.PrimaryKeyConstraint('user_id', name='pk_journal_sync_state'),
    )

    op.create_table(
        'journal_settings',
        *_entity_columns('journal_settings'),
        sa.Column('timezone', sa.String(length=64), nullable=False),
        sa.Column('week_start', sa.SmallInteger(), nullable=False),
        sa.Column('kcal_goal', sa.Integer(), nullable=True),
        sa.Column('protein_g_goal', sa.Integer(), nullable=True),
        sa.Column('fat_g_goal', sa.Integer(), nullable=True),
        sa.Column('carbs_g_goal', sa.Integer(), nullable=True),
        sa.Column('water_ml_goal', sa.Integer(), nullable=True),
        sa.Column('seed_version', sa.Integer(), nullable=False),
        sa.UniqueConstraint('user_id', name='uq_journal_settings_user'),
    )
    _entity_indexes('journal_settings')

    op.create_table(
        'journal_events',
        *_entity_columns('journal_events'),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('start_time', sa.Time(), nullable=True),
        sa.Column('timezone', sa.String(length=64), nullable=True),
        sa.Column('duration_min', sa.Integer(), nullable=True),
        sa.Column('rrule', sa.String(length=255), nullable=True),
        sa.Column('until_date', sa.Date(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('ref_type', sa.String(length=20), nullable=True),
        sa.Column('ref_uuid', sa.String(length=36), nullable=True),
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.Column('color', sa.String(length=20), nullable=True),
    )
    _entity_indexes('journal_events')
    op.create_index('ix_journal_events_user_start', 'journal_events', ['user_id', 'start_date'])

    op.create_table(
        'journal_event_occurrences',
        *_entity_columns('journal_event_occurrences'),
        sa.Column('event_id', BigIntPK, nullable=False),
        sa.Column('occurrence_date', sa.Date(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('moved_date', sa.Date(), nullable=True),
        sa.Column('moved_time', sa.Time(), nullable=True),
        sa.Column('done_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('note', sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['journal_events.id'], ondelete='CASCADE',
                                name='fk_journal_event_occurrences_event_id_journal_events'),
        sa.UniqueConstraint('event_id', 'occurrence_date', name='uq_journal_event_occurrences_event_date'),
    )
    _entity_indexes('journal_event_occurrences')
    op.create_index('ix_journal_event_occurrences_event_id', 'journal_event_occurrences', ['event_id'])
    op.create_index('ix_journal_event_occurrences_user_date', 'journal_event_occurrences',
                    ['user_id', 'occurrence_date'])

    op.create_table(
        'journal_reminders',
        *_entity_columns('journal_reminders'),
        sa.Column('target_type', sa.String(length=20), nullable=False),
        sa.Column('target_uuid', sa.String(length=36), nullable=False),
        sa.Column('offset_min', sa.Integer(), nullable=False),
        sa.Column('time_of_day', sa.Time(), nullable=True),
        sa.Column('rrule', sa.String(length=255), nullable=True),
        sa.Column('enabled', sa.Boolean(), nullable=False),
    )
    _entity_indexes('journal_reminders')
    op.create_index('ix_journal_reminders_user_target', 'journal_reminders', ['user_id', 'target_uuid'])

    op.create_table(
        'journal_diary_entries',
        *_entity_columns('journal_diary_entries'),
        sa.Column('entry_date', sa.Date(), nullable=False),
        sa.Column('entry_time', sa.Time(), nullable=True),
        sa.Column('title', sa.String(length=200), nullable=True),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('body_format', sa.String(length=10), nullable=False),
        sa.Column('mood', sa.SmallInteger(), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.CheckConstraint('mood IS NULL OR (mood >= 1 AND mood <= 5)',
                           name='ck_journal_diary_entries_mood_range'),
    )
    _entity_indexes('journal_diary_entries')
    op.create_index('ix_journal_diary_entries_user_date', 'journal_diary_entries', ['user_id', 'entry_date'])

    op.create_table(
        'journal_trackers',
        *_entity_columns('journal_trackers'),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('value_type', sa.String(length=10), nullable=False),
        sa.Column('unit', sa.String(length=20), nullable=True),
        sa.Column('icon', sa.String(length=50), nullable=True),
        sa.Column('color', sa.String(length=20), nullable=True),
        sa.Column('scale_min', sa.Numeric(14, 4), nullable=True),
        sa.Column('scale_max', sa.Numeric(14, 4), nullable=True),
        sa.Column('frequency', sa.String(length=10), nullable=False),
        sa.Column('goal_value', sa.Numeric(14, 4), nullable=True),
        sa.Column('goal_direction', sa.String(length=20), nullable=True),
        sa.Column('template_key', sa.String(length=30), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('archived', sa.Boolean(), nullable=False),
    )
    _entity_indexes('journal_trackers')

    op.create_table(
        'journal_tracker_values',
        *_entity_columns('journal_tracker_values'),
        sa.Column('tracker_id', BigIntPK, nullable=False),
        sa.Column('value_date', sa.Date(), nullable=False),
        sa.Column('value_time', sa.Time(), nullable=True),
        sa.Column('num_value', sa.Numeric(14, 4), nullable=True),
        sa.Column('text_value', sa.String(length=500), nullable=True),
        sa.Column('note', sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(['tracker_id'], ['journal_trackers.id'], ondelete='CASCADE',
                                name='fk_journal_tracker_values_tracker_id_journal_trackers'),
    )
    _entity_indexes('journal_tracker_values')
    op.create_index('ix_journal_tracker_values_user_date', 'journal_tracker_values', ['user_id', 'value_date'])
    op.create_index('ix_journal_tracker_values_tracker_date', 'journal_tracker_values',
                    ['tracker_id', 'value_date'])

    op.create_table(
        'journal_attachments',
        *_entity_columns('journal_attachments'),
        sa.Column('owner_type', sa.String(length=30), nullable=False),
        sa.Column('owner_uuid', sa.String(length=36), nullable=False),
        sa.Column('storage_key', sa.String(length=500), nullable=True),
        sa.Column('mime', sa.String(length=50), nullable=True),
        sa.Column('size_bytes', sa.Integer(), nullable=True),
        sa.Column('width', sa.Integer(), nullable=True),
        sa.Column('height', sa.Integer(), nullable=True),
    )
    _entity_indexes('journal_attachments')
    op.create_index('ix_journal_attachments_user_owner', 'journal_attachments', ['user_id', 'owner_uuid'])


def downgrade() -> None:
    # Дети раньше родителей (FK)
    for table in (
        'journal_attachments', 'journal_tracker_values', 'journal_trackers', 'journal_diary_entries',
        'journal_reminders', 'journal_event_occurrences', 'journal_events', 'journal_settings',
    ):
        op.drop_table(table)
    op.drop_table('journal_sync_state')
