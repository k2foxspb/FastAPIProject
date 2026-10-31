"""
Упрощённая модель ролей пользователей.

В системе есть ровно три роли:
    owner - владелец (один на систему)
    admin - администратор
    user  - обычный пользователь

В коде роли хранятся латиницей (для совместимости с БД/JWT и т.п.),
но в интерфейсе всегда должны отображаться русские названия - см.
get_role_label()/get_role_labels() ниже.
"""

ROLE_OWNER = "owner"
ROLE_ADMIN = "admin"
ROLE_USER = "user"

ALL_ROLES: list[str] = [ROLE_OWNER, ROLE_ADMIN, ROLE_USER]

ROLE_LABELS: dict[str, str] = {
    ROLE_OWNER: "Владелец",
    ROLE_ADMIN: "Администратор",
    ROLE_USER: "Пользователь",
}


def get_role_label(role: str | None) -> str:
    """Возвращает русское название роли для отображения в интерфейсе."""
    return ROLE_LABELS.get(role or "", role or "")


def get_role_labels() -> dict[str, str]:
    """Справочник код роли -> русское название, для отображения в UI."""
    return dict(ROLE_LABELS)


def is_valid_role(role: str | None) -> bool:
    return role in ALL_ROLES


def is_admin_or_owner(role: str | None) -> bool:
    return role in (ROLE_ADMIN, ROLE_OWNER)


def is_owner(role: str | None) -> bool:
    return role == ROLE_OWNER


def can_assign_admin(current_role: str | None) -> bool:
    """Правило: назначать/снимать администраторов может только владелец."""
    return current_role == ROLE_OWNER


def can_moderate_user(current_role: str | None, target_role: str | None) -> bool:
    """
    Проверяет, может ли пользователь с ролью current_role модерировать
    (например, блокировать/разблокировать) пользователя с ролью target_role:
      - владельца не может заблокировать никто;
      - администратора может заблокировать только владелец;
      - обычного пользователя может заблокировать админ или владелец.
    """
    if target_role == ROLE_OWNER:
        return False
    if target_role == ROLE_ADMIN:
        return current_role == ROLE_OWNER
    return current_role in (ROLE_OWNER, ROLE_ADMIN)


def can_change_role(current_role: str | None, target_role: str | None, new_role: str) -> bool:
    """
    Проверяет, может ли пользователь с ролью current_role сменить роль
    пользователя с текущей ролью target_role на new_role:
      - менять роль владельца нельзя никому (кроме как при явной передаче
        владения самим владельцем - обрабатывается отдельно);
      - назначать/снимать администратора может только владелец;
      - владелец в системе может быть только один (эта проверка - на
        вызывающей стороне, где известно, есть ли уже владелец).
    """
    if target_role == ROLE_OWNER:
        return False
    if new_role == ROLE_OWNER:
        return False
    if new_role == ROLE_ADMIN or target_role == ROLE_ADMIN:
        return can_assign_admin(current_role)
    return current_role in (ROLE_OWNER, ROLE_ADMIN)
