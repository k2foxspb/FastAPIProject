"""
Вспомогательные функции для модуля табеля и учёта сданной продукции:
проверка прав доступа (кто может смотреть/редактировать чей табель и чьи
записи о продукции) и поиск ближайшего вышестоящего пользователя для
отправки уведомлений о согласовании.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.roles import (
    ScopedUser,
    can_manage_user,
    can_view_user,
    get_role_level,
    get_role_scope,
)
from app.models.users import User as UserModel


def to_scoped(user: UserModel) -> ScopedUser:
    return ScopedUser(id=user.id, role=user.role, workshop_id=user.workshop_id, section_id=user.section_id)


def can_view_timesheet(current: UserModel, target: UserModel) -> bool:
    """
    Правило 1: пользователь самого нижнего уровня видит только свой табель;
    пользователи выше по должности видят табели подчинённых по иерархии.
    """
    return can_view_user(to_scoped(current), to_scoped(target))


def can_edit_timesheet(current: UserModel, target: UserModel) -> bool:
    """
    Правило 1: пользователь самого нижнего уровня редактирует только свой
    табель; вышестоящие пользователи - табели подчинённых.
    """
    if current.id == target.id:
        return True
    return can_manage_user(to_scoped(current), to_scoped(target))


def can_review_production(current: UserModel, owner: UserModel) -> bool:
    """
    Правило 11: пользователь не может согласовывать собственные записи и
    может согласовывать только записи своих подчинённых по иерархии.
    """
    if current.id == owner.id:
        return False
    return can_manage_user(to_scoped(current), to_scoped(owner))


def can_edit_production_entry(current: UserModel, owner: UserModel, status: str) -> bool:
    """
    Правило 4 и 7: сотрудник может редактировать свою запись, пока она не
    подтверждена/отклонена; вышестоящий пользователь (или админ) может
    редактировать записи подчинённых в любом статусе.
    """
    if current.id == owner.id:
        return status in ("draft", "pending", "rejected")
    if current.role in ("admin", "owner"):
        return True
    return can_manage_user(to_scoped(current), to_scoped(owner))


async def get_subordinates(db: AsyncSession, current: UserModel, include_self: bool = False) -> list[UserModel]:
    """
    Возвращает всех подчинённых текущего пользователя по иерархии должностей
    (строго ниже по уровню и в пределах зоны ответственности) - используется
    для сводной таблицы часов/продукции по подчинённым.

    Если include_self=True и у текущего пользователя должность с зоной
    ответственности "workshop" или "global" (начальник цеха и выше), он сам
    добавляется в список - такие пользователи должны видеть и свою строку
    в сводной таблице подчинённых, а не только строки своих подчинённых.
    """
    result = await db.execute(select(UserModel).where(UserModel.is_active == True))
    candidates = result.scalars().all()
    scoped_current = to_scoped(current)
    subordinates = [
        u for u in candidates
        if u.id != current.id and can_manage_user(scoped_current, to_scoped(u))
    ]
    if include_self and get_role_scope(current.role) in ("global", "workshop"):
        subordinates.append(current)
    subordinates.sort(key=lambda u: get_role_level(u.role))
    return subordinates


async def find_nearest_supervisors(db: AsyncSession, target: UserModel) -> list[UserModel]:
    """
    Находит ближайшего вышестоящего пользователя (пользователей, если на
    одном уровне несколько) по иерархии должностей в зоне ответственности
    target - для отправки уведомления о внесённой/изменённой продукции.
    """
    target_level = get_role_level(target.role)
    result = await db.execute(select(UserModel).where(UserModel.is_active == True))
    candidates = result.scalars().all()

    scoped_target = to_scoped(target)
    supervisors: list[tuple[int, UserModel]] = []
    for candidate in candidates:
        if candidate.id == target.id:
            continue
        if get_role_level(candidate.role) >= target_level:
            continue
        if can_manage_user(to_scoped(candidate), scoped_target):
            supervisors.append((get_role_level(candidate.role), candidate))

    if not supervisors:
        return []

    nearest_level = max(level for level, _ in supervisors)
    return [user for level, user in supervisors if level == nearest_level]


async def find_all_supervisors(db: AsyncSession, target: UserModel) -> list[UserModel]:
    """
    Находит всех вышестоящих пользователей (всю цепочку руководителей, а не
    только ближайший уровень) по иерархии должностей в зоне ответственности
    target - используется, чтобы дать сотруднику выбрать галочками,
    кого из вышестоящих руководителей дополнительно уведомить об изменении
    табеля, помимо ближайшего руководителя, который уведомляется всегда.
    """
    target_level = get_role_level(target.role)
    result = await db.execute(select(UserModel).where(UserModel.is_active == True))
    candidates = result.scalars().all()

    scoped_target = to_scoped(target)
    supervisors = [
        candidate for candidate in candidates
        if candidate.id != target.id
        and get_role_level(candidate.role) < target_level
        and can_manage_user(to_scoped(candidate), scoped_target)
    ]
    supervisors.sort(key=lambda u: get_role_level(u.role), reverse=True)
    return supervisors
