"""
Иерархическая модель ролей для производственной структуры.

Иерархия (сверху вниз, по возрастанию уровня):
    0 - owner              (владелец)
    1 - shop_chief         (начальник цеха)
    2 - section_chief      (начальник участка)
    3 - master             (мастер участка)
    4 - assistant_master   (помощник мастера участка)
    5 - worker             (рабочий)

Чем МЕНЬШЕ уровень - тем ВЫШЕ роль в иерархии.
Пользователь может управлять (назначать роли, редактировать, удалять,
перемещать) только пользователями со СТРОГО большим уровнем (то есть
находящимися ниже него по иерархии) и только в пределах своей зоны
ответственности (цех/участок).
"""
from dataclasses import dataclass

ROLE_OWNER = "owner"
ROLE_SHOP_CHIEF = "shop_chief"
ROLE_SECTION_CHIEF = "section_chief"
ROLE_MASTER = "master"
ROLE_ASSISTANT_MASTER = "assistant_master"
ROLE_WORKER = "worker"

# Уровень иерархии: чем меньше число, тем выше роль.
ROLE_HIERARCHY: dict[str, int] = {
    ROLE_OWNER: 0,
    ROLE_SHOP_CHIEF: 1,
    ROLE_SECTION_CHIEF: 2,
    ROLE_MASTER: 3,
    ROLE_ASSISTANT_MASTER: 4,
    ROLE_WORKER: 5,
}

PRODUCTION_ROLES: list[str] = list(ROLE_HIERARCHY.keys())

ROLE_LABELS_RU: dict[str, str] = {
    ROLE_OWNER: "Владелец",
    ROLE_SHOP_CHIEF: "Начальник цеха",
    ROLE_SECTION_CHIEF: "Начальник участка",
    ROLE_MASTER: "Мастер участка",
    ROLE_ASSISTANT_MASTER: "Помощник мастера участка",
    ROLE_WORKER: "Рабочий",
}

# Область ответственности каждой роли: "global", "workshop", "section" или "self"
ROLE_SCOPE: dict[str, str] = {
    ROLE_OWNER: "global",
    ROLE_SHOP_CHIEF: "workshop",
    ROLE_SECTION_CHIEF: "section",
    ROLE_MASTER: "section",
    ROLE_ASSISTANT_MASTER: "section",
    ROLE_WORKER: "self",
}


def is_production_role(role: str | None) -> bool:
    return role in ROLE_HIERARCHY


def get_role_level(role: str | None) -> int:
    """
    Возвращает числовой уровень роли в иерархии.
    Роли, не относящиеся к производственной иерархии, считаются
    самыми низкими по уровню, чтобы не дать им никаких
    управленческих прав в иерархии.
    """
    return ROLE_HIERARCHY.get(role, max(ROLE_HIERARCHY.values()) + 1)


def get_role_scope(role: str | None) -> str:
    return ROLE_SCOPE.get(role, "self")


def is_higher_or_equal(role_a: str, role_b: str) -> bool:
    """True, если role_a находится выше или на одном уровне с role_b."""
    return get_role_level(role_a) <= get_role_level(role_b)


def get_assignable_roles(current_role: str | None) -> list[str]:
    """
    Список ролей, которые пользователь с ролью current_role имеет право
    назначать другим пользователям (только строго ниже себя).
    """
    current_level = get_role_level(current_role)
    return [role for role, level in ROLE_HIERARCHY.items() if level > current_level]


def can_assign_role(current_role: str | None, target_role: str) -> bool:
    """
    Правило 1 и 2: пользователь может назначать роли только строго ниже своего уровня.
    """
    if not is_production_role(target_role):
        return False
    return get_role_level(target_role) > get_role_level(current_role)


@dataclass
class ScopedUser:
    """Минимальный набор данных, необходимый для проверки прав по иерархии."""
    id: int
    role: str
    workshop_id: int | None = None
    section_id: int | None = None


def _in_scope(current: ScopedUser, target: ScopedUser) -> bool:
    """
    Проверяет, находится ли target в зоне ответственности current
    (правило 4): владелец - вся система; начальник цеха - свой цех;
    начальник участка/мастер/помощник мастера - свой участок.
    """
    scope = get_role_scope(current.role)
    if scope == "global":
        return True
    if scope == "workshop":
        return current.workshop_id is not None and target.workshop_id == current.workshop_id
    if scope == "section":
        return current.section_id is not None and target.section_id == current.section_id
    # scope == "self": рабочий не управляет никем, кроме себя
    return target.id == current.id


def can_manage_user(current: ScopedUser, target: ScopedUser) -> bool:
    """
    Правило 3 и 4: нельзя управлять (редактировать/удалять/назначать роль)
    пользователем с ролью выше либо равной своей, и только в пределах
    своей зоны ответственности.
    """
    if current.id == target.id:
        return False
    if current.role == ROLE_OWNER:
        return True
    if get_role_level(target.role) <= get_role_level(current.role):
        return False
    return _in_scope(current, target)


def can_view_user(current: ScopedUser, target: ScopedUser) -> bool:
    """
    Пользователь видит себя всегда, а также всех, кем может управлять
    в своей зоне ответственности (владелец видит вообще всех).
    """
    if current.id == target.id:
        return True
    if current.role == ROLE_OWNER:
        return True
    return _in_scope(current, target)


def can_move_worker(current: ScopedUser, worker: ScopedUser, target_section_id: int, target_workshop_id: int | None) -> bool:
    """
    Правила 5 и 6: перемещение рабочих между участками.
    - Владелец может перемещать рабочих между любыми участками.
    - Начальник цеха - только между участками своего цеха.
    - Нижестоящие роли - только в рамках своих разрешений (в данной модели
      участок для них уже совпадает с их собственным, поэтому перемещение
      в другой участок для них запрещено).
    """
    if worker.role != ROLE_WORKER:
        return False

    if current.role == ROLE_OWNER:
        return True

    if current.role == ROLE_SHOP_CHIEF:
        if current.workshop_id is None:
            return False
        if worker.workshop_id != current.workshop_id:
            return False
        return target_workshop_id == current.workshop_id

    if current.role in (ROLE_SECTION_CHIEF, ROLE_MASTER, ROLE_ASSISTANT_MASTER):
        # Разрешено перемещение только внутри собственного участка
        # (например, между бригадами/сменами, если такая логика появится).
        if current.section_id is None:
            return False
        return worker.section_id == current.section_id and target_section_id == current.section_id

    return False


def get_notification_scope_filter(current: ScopedUser):
    """
    Возвращает информацию, какая часть пользователей должна получить
    уведомление об объявлении, созданном current (правило уведомлений).
    Результат - кортеж (scope, value), который нужно использовать при
    построении SQL-запроса к таблице пользователей:
        ("global", None)        - все пользователи ниже владельца
        ("workshop", workshop_id) - все пользователи цеха ниже начальника цеха
        ("section", section_id)   - все пользователи участка ниже текущей роли
        (None, None)               - уведомления отправлять некому (рабочий)
    """
    scope = get_role_scope(current.role)
    if scope == "global":
        return "global", None
    if scope == "workshop":
        return "workshop", current.workshop_id
    if scope == "section":
        return "section", current.section_id
    return None, None
