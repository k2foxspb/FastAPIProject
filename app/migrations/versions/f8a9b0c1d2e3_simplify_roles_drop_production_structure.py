"""simplify_roles_drop_production_structure

Удаляет всю "производственную" структуру (цеха/участки/должности/и.о.),
табель и продукцию, документы, заявления и старые объявления - этот
функционал полностью убран из приложения в пользу упрощённой модели ролей
(owner/admin/user) и единой ленты с модерацией.

Также:
- убирает из users колонки workshop_id/section_id/tab_number/work_schedule_hours;
- переводит все роли, кроме owner/admin, в "user";
- добавляет в profile_posts колонки post_type/moderation_status/is_hidden;
- создаёт таблицу notifications.

Исторические данные табеля/продукции/документов/заявлений/старых объявлений
не переносятся и не восстанавливаются (не требуется по ТЗ).

Revision ID: f8a9b0c1d2e3
Revises: d6e7f8a9b0c1
Create Date: 2026-10-31 16:50:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f8a9b0c1d2e3'
down_revision: Union[str, Sequence[str], None] = 'd6e7f8a9b0c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _drop_table_cascade(bind, inspector, table: str) -> None:
    """
    Удаляет таблицу, если она существует, используя CASCADE на PostgreSQL,
    чтобы любые зависимые объекты (внешние ключи из таблиц, которые по
    каким-то причинам не были удалены ранее в этой же миграции) не мешали
    удалению (см. DependentObjectsStillExistError). На других диалектах
    (например SQLite в тестах) CASCADE не поддерживается - используется
    обычный op.drop_table.
    """
    if table not in inspector.get_table_names():
        return
    if bind.dialect.name == 'postgresql':
        op.execute(sa.text(f'DROP TABLE IF EXISTS "{table}" CASCADE'))
    else:
        op.drop_table(table)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    # --- 1. Удаление таблиц табеля и учёта продукции ---
    # Порядок важен: сначала таблицы, ссылающиеся на timesheet_entries
    # (согласования и аудит-лог табеля), иначе DROP TABLE timesheet_entries
    # падает с DependentObjectsStillExistError.
    for table in [
        'production_audit_logs',
        'production_entry_items',
        'production_entries',
        'production_products',
        'timesheet_entry_approvals',
        'timesheet_audit_logs',
        'timesheet_entries',
    ]:
        _drop_table_cascade(bind, inspector, table)

    # --- 2. Удаление таблиц заявлений ---
    # statement_audit_logs и statement_approvals ссылаются на statements -
    # удаляются первыми по той же причине, что и выше.
    for table in [
        'statement_audit_logs',
        'statement_approvals',
        'statement_template_recipients',
        'statements',
        'statement_templates',
    ]:
        _drop_table_cascade(bind, inspector, table)

    # --- 3. Удаление таблиц документов ---
    for table in [
        'document_images',
        'document_assignments',
        'document_approvals',
        'documents',
        'document_categories',
    ]:
        _drop_table_cascade(bind, inspector, table)

    # --- 4. Удаление старых объявлений (заменены ProfilePost.post_type="announcement") ---
    for table in [
        'announcement_comments',
        'announcement_recipients',
        'announcements',
    ]:
        _drop_table_cascade(bind, inspector, table)

    # --- 5. Удаление и.о. и производственной иерархии (должности/цеха/участки) ---
    if 'acting_assignments' in inspector.get_table_names():
        existing_indexes = {ix['name'] for ix in inspector.get_indexes('acting_assignments')}
        if 'ix_acting_assignments_is_active' in existing_indexes:
            op.drop_index('ix_acting_assignments_is_active', table_name='acting_assignments')
        if 'ix_acting_assignments_user_id' in existing_indexes:
            op.drop_index('ix_acting_assignments_user_id', table_name='acting_assignments')
        _drop_table_cascade(bind, inspector, 'acting_assignments')

    if 'positions' in inspector.get_table_names():
        _drop_table_cascade(bind, inspector, 'positions')

    # --- 6. Удаление колонок users, ссылающихся на цеха/участки/табель ---
    existing_tables = inspector.get_table_names()
    users_columns = [c['name'] for c in inspector.get_columns('users')]
    existing_fks = {fk['name'] for fk in inspector.get_foreign_keys('users')}
    with op.batch_alter_table('users') as batch_op:
        if 'fk_users_workshop_id' in existing_fks:
            batch_op.drop_constraint('fk_users_workshop_id', type_='foreignkey')
        if 'fk_users_section_id' in existing_fks:
            batch_op.drop_constraint('fk_users_section_id', type_='foreignkey')
        if 'workshop_id' in users_columns:
            batch_op.drop_column('workshop_id')
        if 'section_id' in users_columns:
            batch_op.drop_column('section_id')
        if 'tab_number' in users_columns:
            batch_op.drop_column('tab_number')
        if 'work_schedule_hours' in users_columns:
            batch_op.drop_column('work_schedule_hours')

    if 'sections' in existing_tables:
        op.drop_table('sections')
    if 'workshops' in existing_tables:
        op.drop_table('workshops')

    # --- 7. Приведение ролей к упрощённой модели owner/admin/user ---
    # Все роли, кроме owner и admin (старые производственные роли:
    # worker/master/section_chief/shop_chief/assistant_master/buyer и т.п.),
    # становятся "user".
    op.execute("UPDATE users SET role = 'user' WHERE role NOT IN ('owner', 'admin')")

    # --- 8. Новые поля ProfilePost (объявления и модерация) ---
    profile_posts_columns = [c['name'] for c in inspector.get_columns('profile_posts')]
    with op.batch_alter_table('profile_posts') as batch_op:
        if 'post_type' not in profile_posts_columns:
            batch_op.add_column(
                sa.Column('post_type', sa.String(length=20), nullable=False, server_default='post')
            )
        if 'moderation_status' not in profile_posts_columns:
            batch_op.add_column(
                sa.Column('moderation_status', sa.String(length=20), nullable=False, server_default='pending')
            )
        if 'is_hidden' not in profile_posts_columns:
            batch_op.add_column(
                sa.Column('is_hidden', sa.Boolean(), nullable=False, server_default=sa.false())
            )

    # --- 9. Таблица уведомлений (колокольчик) ---
    if 'notifications' not in inspector.get_table_names():
        op.create_table(
            'notifications',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('actor_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('notif_type', sa.String(length=50), nullable=False),
            sa.Column('title', sa.String(length=255), nullable=False),
            sa.Column('body', sa.String(), nullable=True),
            sa.Column('group_key', sa.String(length=255), nullable=True),
            sa.Column('data', sa.JSON(), nullable=True),
            sa.Column('count', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('is_read', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('is_unremovable', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column(
                'updated_at', sa.DateTime(timezone=True),
                server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False,
            ),
        )
        op.create_index('ix_notifications_user_id', 'notifications', ['user_id'])
        op.create_index('ix_notifications_notif_type', 'notifications', ['notif_type'])
        op.create_index('ix_notifications_group_key', 'notifications', ['group_key'])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    # --- Таблица уведомлений ---
    if 'notifications' in existing_tables:
        op.drop_index('ix_notifications_group_key', table_name='notifications')
        op.drop_index('ix_notifications_notif_type', table_name='notifications')
        op.drop_index('ix_notifications_user_id', table_name='notifications')
        op.drop_table('notifications')

    # --- Новые поля ProfilePost ---
    profile_posts_columns = [c['name'] for c in inspector.get_columns('profile_posts')]
    with op.batch_alter_table('profile_posts') as batch_op:
        if 'is_hidden' in profile_posts_columns:
            batch_op.drop_column('is_hidden')
        if 'moderation_status' in profile_posts_columns:
            batch_op.drop_column('moderation_status')
        if 'post_type' in profile_posts_columns:
            batch_op.drop_column('post_type')

    # --- Роли и удалённые таблицы/колонки не восстанавливаются -
    # исторические данные табеля/продукции/документов/заявлений/объявлений
    # не сохранялись при upgrade(), поэтому откат этой части невозможен.
    # Ниже воссоздаются только пустые таблицы/колонки, чтобы схема БД была
    # формально совместима с предыдущей ревизией.

    users_columns = [c['name'] for c in inspector.get_columns('users')]
    with op.batch_alter_table('users') as batch_op:
        if 'workshop_id' not in users_columns:
            batch_op.add_column(sa.Column('workshop_id', sa.Integer(), nullable=True))
        if 'section_id' not in users_columns:
            batch_op.add_column(sa.Column('section_id', sa.Integer(), nullable=True))
        if 'tab_number' not in users_columns:
            batch_op.add_column(sa.Column('tab_number', sa.String(), nullable=True))
        if 'work_schedule_hours' not in users_columns:
            batch_op.add_column(
                sa.Column('work_schedule_hours', sa.Numeric(precision=4, scale=2), nullable=True, server_default='8')
            )

    if 'workshops' not in inspector.get_table_names():
        op.create_table(
            'workshops',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(length=200), nullable=False),
            sa.Column('description', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
        )

    if 'sections' not in inspector.get_table_names():
        op.create_table(
            'sections',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('workshop_id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(length=200), nullable=False),
            sa.Column('description', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(['workshop_id'], ['workshops.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )

    with op.batch_alter_table('users') as batch_op:
        batch_op.create_foreign_key(
            'fk_users_workshop_id', 'workshops', ['workshop_id'], ['id'], ondelete='SET NULL'
        )
        batch_op.create_foreign_key(
            'fk_users_section_id', 'sections', ['section_id'], ['id'], ondelete='SET NULL'
        )

    if 'positions' not in inspector.get_table_names():
        op.create_table(
            'positions',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('code', sa.String(length=50), nullable=False),
            sa.Column('name', sa.String(length=200), nullable=False),
            sa.Column('level', sa.Integer(), nullable=False),
            sa.Column('scope', sa.String(length=20), nullable=False, server_default='section'),
            sa.Column('is_system', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('code', name='uq_positions_code'),
            sa.UniqueConstraint('level', name='uq_positions_level'),
        )

    if 'acting_assignments' not in inspector.get_table_names():
        op.create_table(
            'acting_assignments',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('replaced_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('acting_role', sa.String(length=50), nullable=False),
            sa.Column('acting_workshop_id', sa.Integer(), sa.ForeignKey('workshops.id', ondelete='SET NULL'), nullable=True),
            sa.Column('acting_section_id', sa.Integer(), sa.ForeignKey('sections.id', ondelete='SET NULL'), nullable=True),
            sa.Column('assigned_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index('ix_acting_assignments_user_id', 'acting_assignments', ['user_id'])
        op.create_index('ix_acting_assignments_is_active', 'acting_assignments', ['is_active'])

    # Объявления, документы, заявления, табель и продукция: данные не
    # восстанавливаются, таблицы заново не создаются (не требуется по ТЗ).
