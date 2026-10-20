"""
Иерархическая модель ролей (должностей) для производственной структуры.

Должности больше не захардкожены в коде: они хранятся в таблице `positions`
(см. app.models.structure.Position) и могут создаваться, переименовываться,
удаляться и переупорядочиваться владельцем через API /org/positions.
Иерархия задаётся полем `level`: чем МЕНЬШЕ уровень - тем ВЫШЕ должность.

По умолчанию (сразу после миграции) в системе есть 6 должностей:
    0 - owner              (владелец)
    1 - shop_chief         (начальник цеха)
    2 - section_chief      (начальник участка)
    3 - master             (мастер участка)
    4 - assistant_master   (помощник мастера участка)
    5 - worker             (рабочий)

Должности с level, равным самому нижнему уровню иерархии (scope="self"),
не являются единственной и неповторимой должностью "рабочий" - на этом
уровне можно создать сколько угодно разных должностей (например, разные
рабочие специальности) с одинаковым level: они равноправны и не управляют
друг другом (см. app.api.routers.structure).

Только "owner" помечен как системная должность (is_system) и не может
быть удалён - на нём завязана часть бизнес-логики (единственный владелец
системы).

Пользователь может управлять (назначать роли, редактировать, удалять,
перемещать) только пользователями со СТРОГО большей должностью по уровню
(то есть находящимися ниже него по иерархии) и только в пределах своей зоны
ответственности (цех/участок).
"""
from dataclasses import dataclass
from threading import Lock

ROLE_ADMIN = "admin"
ROLE_OWNER = "owner"
ROLE_SHOP_CHIEF = "shop_chief"
ROLE_SECTION_CHIEF = "section_chief"
ROLE_MASTER = "master"
ROLE_ASSISTANT_MASTER = "assistant_master"
ROLE_WORKER = "worker"

# Должности по умолчанию - используются для сидирования миграции и как
# аварийный запасной вариант, если таблица positions ещё не создана/пуста.
DEFAULT_POSITIONS: list[dict] = [
    {"code": ROLE_OWNER, "name": "Владелец", "level": 0, "scope": "global", "icon": "ribbon", "is_system": True},
    {"code": ROLE_SHOP_CHIEF, "name": "Начальник цеха", "level": 1, "scope": "workshop", "icon": "business", "is_system": False},
    {"code": ROLE_SECTION_CHIEF, "name": "Начальник участка", "level": 2, "scope": "section", "icon": "briefcase", "is_system": False},
    {"code": ROLE_MASTER, "name": "Мастер участка", "level": 3, "scope": "section", "icon": "construct", "is_system": False},
    {"code": ROLE_ASSISTANT_MASTER, "name": "Помощник мастера участка", "level": 4, "scope": "section", "icon": "hammer", "is_system": False},
    {"code": ROLE_WORKER, "name": "Рабочий", "level": 5, "scope": "self", "icon": "hardware-chip", "is_system": False},
]

_cache_lock = Lock()
# None означает "кэш ещё не загружен из БД" - в этом случае используем
# DEFAULT_POSITIONS, чтобы иерархия работала даже до первого вызова
# load_positions_cache() (например, в скриптах/тестах без запуска приложения).
_positions_cache: list[dict] | None = None


def _positions_to_dicts(rows) -> list[dict]:
    return [
        {
            "id": r.id,
            "code": r.code,
            "name": r.name,
            "level": r.level,
            "scope": r.scope,
            "icon": r.icon,
            "is_system": r.is_system,
        }
        for r in rows
    ]


async def load_positions_cache(db) -> list[dict]:
    """
    Асинхронно перечитывает должности из БД (таблица positions) и обновляет
    кэш. Нужно вызывать при старте приложения, а также после любого
    создания, изменения, удаления или переупорядочивания должностей через
    /org/positions, чтобы изменения сразу же учитывались во всех проверках
    иерархии.
    """
    from sqlalchemy import select
    from app.models.structure import Position

    global _positions_cache
    try:
        result = await db.execute(select(Position).order_by(Position.level.asc()))
        rows = result.scalars().all()
        new_cache = _positions_to_dicts(rows) if rows else [dict(p) for p in DEFAULT_POSITIONS]
    except Exception:
        # Таблица ещё не создана (например, до применения миграции) - остаёмся
        # на запасном варианте.
        new_cache = [dict(p) for p in DEFAULT_POSITIONS]

    with _cache_lock:
        _positions_cache = new_cache
    return new_cache


def refresh_positions_cache() -> None:
    """
    Сбрасывает кэш должностей в запасной вариант. Используется как
    предохранитель - полноценное обновление делает load_positions_cache().
    """
    global _positions_cache
    with _cache_lock:
        _positions_cache = None


def _get_positions() -> list[dict]:
    if _positions_cache is None:
        return [dict(p) for p in DEFAULT_POSITIONS]
    return _positions_cache


def get_all_positions() -> list[dict]:
    """Все должности, отсортированные от самой высокой к самой низкой по иерархии."""
    return list(_get_positions())


def _positions_by_code() -> dict[str, dict]:
    return {p["code"]: p for p in _get_positions()}


def get_production_roles() -> list[str]:
    """Коды всех должностей производственной иерархии (ранее - PRODUCTION_ROLES)."""
    return [p["code"] for p in _get_positions()]


# Обратная совместимость: некоторые места когда-то импортировали статический
# список. Функция выше - источник истины, этот список использовать как
# константу больше нельзя (устарел сразу после первого изменения должностей).
PRODUCTION_ROLES: list[str] = get_production_roles()


def get_role_labels() -> dict[str, str]:
    return {p["code"]: p["name"] for p in _get_positions()}


def get_role_label(role: str | None) -> str:
    return _positions_by_code().get(role, {}).get("name", role or "")


def get_table_role_label(role: str | None) -> str:
    """
    Название должности для табличных представлений табеля (сводная таблица
    подчинённых, выгрузка в Excel): учитывает только должности
    производственной иерархии - старые системные роли (admin и т.п.) здесь
    не должны отображаться. Если роль не входит в иерархию (например,
    "admin", либо должность не задана), возвращается "Должность не задана".
    """
    position = _positions_by_code().get(role)
    return position["name"] if position else "Должность не задана"


def is_production_role(role: str | None) -> bool:
    return role in _positions_by_code()


def get_role_level(role: str | None) -> int:
    """
    Возвращает числовой уровень должности в иерархии.
    Роли, не относящиеся к производственной иерархии, считаются
    самыми низкими по уровню, чтобы не дать им никаких
    управленческих прав в иерархии.
    """
    positions = _get_positions()
    by_code = {p["code"]: p["level"] for p in positions}
    max_level = max((p["level"] for p in positions), default=0)
    return by_code.get(role, max_level + 1)


def get_role_scope(role: str | None) -> str:
    return _positions_by_code().get(role, {}).get("scope", "self")


def is_higher_or_equal(role_a: str, role_b: str) -> bool:
    """True, если role_a находится выше или на одном уровне с role_b."""
    return get_role_level(role_a) <= get_role_level(role_b)


def get_assignable_roles(current_role: str | None) -> list[str]:
    """
    Список должностей, которые пользователь с ролью current_role имеет право
    назначать другим пользователям (только строго ниже себя).
    """
    current_level = get_role_level(current_role)
    return [p["code"] for p in _get_positions() if p["level"] > current_level]


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
    (правило 4): владелец (scope=global) - вся система; должность со scope=workshop -
    свой цех; должность со scope=section - свой участок.
    """
    scope = get_role_scope(current.role)
    if scope == "global":
        return True
    if scope == "workshop":
        return current.workshop_id is not None and target.workshop_id == current.workshop_id
    if scope == "section":
        return current.section_id is not None and target.section_id == current.section_id
    # scope == "self": рядовой сотрудник не управляет никем, кроме себя
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
    Правила 5 и 6: перемещение рядовых сотрудников (должность со scope="self")
    между участками.
    - Владелец может перемещать таких сотрудников между любыми участками.
    - Начальник цеха (scope="workshop") - только между участками своего цеха.
    - Нижестоящие роли - только в рамках своих разрешений (в данной модели
      участок для них уже совпадает с их собственным, поэтому перемещение
      в другой участок для них запрещено).
    """
    if get_role_scope(worker.role) != "self":
        return False

    if current.role == ROLE_OWNER:
        return True

    current_scope = get_role_scope(current.role)
    if current_scope == "workshop":
        if current.workshop_id is None:
            return False
        if worker.workshop_id != current.workshop_id:
            return False
        return target_workshop_id == current.workshop_id

    if current_scope == "section":
        # Разрешено перемещение только внутри собственного участка
        # (например, между бригадами/сменами, если такая логика появится).
        if current.section_id is None:
            return False
        return worker.section_id == current.section_id and target_section_id == current.section_id

    return False


def can_assign_acting(current_role: str | None, acting_role: str, assignee_current_role: str | None) -> bool:
    """
    Проверяет, может ли пользователь с ролью current_role назначить и.о.
    на должность acting_role сотрудника, чья СОБСТВЕННАЯ (основная)
    должность - assignee_current_role.
    Назначать может только тот, кто строго выше по иерархии и замещаемой
    должности, и исходной должности того, кого назначают и.о.
    """
    if not is_production_role(acting_role):
        return False
    current_level = get_role_level(current_role)
    if get_role_level(acting_role) <= current_level:
        return False
    if get_role_level(assignee_current_role) <= current_level:
        return False
    return True


async def get_active_acting_assignment(db, user_id: int):
    """
    Возвращает активное на текущий момент назначение и.о. (app.models.structure.ActingAssignment)
    для указанного пользователя, либо None, если такого назначения нет.
    """
    from datetime import datetime, timezone
    from sqlalchemy import select, or_
    from app.models.structure import ActingAssignment

    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(ActingAssignment).where(
            ActingAssignment.user_id == user_id,
            ActingAssignment.is_active == True,  # noqa: E712
            ActingAssignment.starts_at <= now,
            or_(ActingAssignment.ends_at.is_(None), ActingAssignment.ends_at >= now),
        )
    )
    return result.scalars().first()


async def apply_effective_role(user, db) -> None:
    """
    Единая точка входа для подмены эффективной должности пользователя.
    Если у user есть активное назначение и.о. (ActingAssignment), подменяет
    его role/workshop_id/section_id на снимок замещаемой должности
    (acting_role/acting_workshop_id/acting_section_id), зафиксированный на
    момент создания назначения.

    Подмена происходит ТОЛЬКО в памяти текущего запроса: объект
    отсоединяется от сессии (db.expunge), чтобы случайный commit() где-то
    дальше по цепочке обработки запроса не сохранил эту подмену в БД и не
    затронул настоящую должность пользователя (users.role). Исходные
    значения сохраняются в user.original_role/original_workshop_id/
    original_section_id - например, для отображения в профиле.
    """
    assignment = await get_active_acting_assignment(db, user.id)
    if assignment is None:
        return

    db.expunge(user)
    user.original_role = user.role
    user.original_workshop_id = user.workshop_id
    user.original_section_id = user.section_id
    user.acting_assignment_id = assignment.id
    user.role = assignment.acting_role
    user.workshop_id = assignment.acting_workshop_id
    user.section_id = assignment.acting_section_id


def get_notification_scope_filter(current: ScopedUser):
    """
    Возвращает информацию, какая часть пользователей должна получить
    уведомление об объявлении, созданном current (правило уведомлений).
    Результат - кортеж (scope, value), который нужно использовать при
    построении SQL-запроса к таблице пользователей:
        ("global", None)          - все пользователи ниже владельца
        ("workshop", workshop_id) - все пользователи цеха ниже начальника цеха
        ("section", section_id)   - все пользователи участка ниже текущей роли
        (None, None)               - уведомления отправлять некому
    """
    scope = get_role_scope(current.role)
    if scope == "global":
        return "global", None
    if scope == "workshop":
        return "workshop", current.workshop_id
    if scope == "section":
        return "section", current.section_id
    return None, None
