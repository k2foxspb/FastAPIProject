"""
Стартовые наборы журнала.

Идентификаторы стартовых записей детерминированы (UUIDv5 от user_id и ключа),
поэтому клиент может создать их локально даже офлайн, а сервер - при первой
синхронизации: upsert по одному и тому же UUID идемпотентен, дублей не будет.
Набор создаётся один раз - версия хранится в journal_settings.seed_version.
"""
import uuid
from datetime import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config
from app.models.journal import JournalMealType, JournalSettings
from app.models.journal.base import utcnow

# Пространство имён UUIDv5 журнала (то же значение используется в mobile/src/journal/utils/seed.js).
NS_JOURNAL = uuid.UUID("6f2c1a3e-8d4b-4f7a-9c1e-2b5d7e9f0a13")
# 1 - настройки (фаза 1); 2 - типы приёмов пищи (фаза 2)
SEED_VERSION = 2

# Стартовые типы приёмов пищи (ключ UUIDv5 - "meal_type:<key>"); напоминания выключены,
# пользователь включает их сам на экране «Приёмы пищи».
MEAL_TYPES = [
    {"key": "breakfast", "name": "Завтрак", "default_time": time(8, 0), "icon": "cafe-outline", "sort_order": 10},
    {"key": "lunch", "name": "Обед", "default_time": time(13, 0), "icon": "restaurant-outline", "sort_order": 20},
    {"key": "snack", "name": "Перекус", "default_time": time(16, 30), "icon": "nutrition-outline", "sort_order": 30},
    {"key": "dinner", "name": "Ужин", "default_time": time(19, 0), "icon": "moon-outline", "sort_order": 40},
]

# Шаблоны трекеров (не создаются автоматически - предлагаются при создании трекера).
TRACKER_TEMPLATES = [
    {"template_key": "weight", "name": "Вес", "value_type": "number", "unit": "кг",
     "icon": "scale-outline", "color": "#4F8EF7", "frequency": "daily"},
    {"template_key": "sleep", "name": "Сон", "value_type": "duration", "unit": "мин",
     "icon": "bed-outline", "color": "#7E57C2", "frequency": "daily"},
    {"template_key": "mood", "name": "Настроение", "value_type": "scale", "scale_min": 1, "scale_max": 5,
     "icon": "happy-outline", "color": "#FFB300", "frequency": "daily"},
    {"template_key": "wellbeing", "name": "Самочувствие", "value_type": "scale", "scale_min": 1, "scale_max": 10,
     "icon": "heart-outline", "color": "#E53935", "frequency": "daily"},
    {"template_key": "habit", "name": "Привычка", "value_type": "bool",
     "icon": "checkmark-done-outline", "color": "#43A047", "frequency": "daily"},
]


def seed_uuid(user_id: int, key: str) -> str:
    return str(uuid.uuid5(NS_JOURNAL, f"{user_id}:{key}"))


async def ensure_seed(db: AsyncSession, user_id: int, only_upgrade: bool = False) -> bool:
    """
    Создаёт стартовые записи пользователя, если их ещё нет. Возвращает True,
    если что-то было создано (вызывающий код делает commit).
    only_upgrade=True - только досоздать наборы новых фаз тем, у кого настройки уже есть.
    """
    from app.services.journal.sync_service import lock_state, next_rev

    existing = (await db.execute(
        select(JournalSettings).where(JournalSettings.user_id == user_id)
    )).scalar_one_or_none()
    if existing is not None and existing.seed_version >= SEED_VERSION:
        return False
    if existing is None and only_upgrade:
        return False

    state = await lock_state(db, user_id)
    now = utcnow()
    version = existing.seed_version if existing is not None else 0

    if version < 2:
        # Ищем и среди удалённых: если пользователь удалил стартовую запись, не воскрешаем её
        keys = {seed_uuid(user_id, f"meal_type:{m['key']}"): m for m in MEAL_TYPES}
        present = set((await db.execute(
            select(JournalMealType.client_uuid).where(
                JournalMealType.user_id == user_id,
                JournalMealType.client_uuid.in_(list(keys)),
            )
        )).scalars().all())
        for client_uuid, item in keys.items():
            if client_uuid in present:
                continue
            db.add(JournalMealType(
                user_id=user_id,
                client_uuid=client_uuid,
                name=item["name"],
                default_time=item["default_time"],
                icon=item["icon"],
                sort_order=item["sort_order"],
                reminder_enabled=False,
                created_at=now,
                updated_at=now,
                server_rev=next_rev(state),
            ))

    if existing is None:
        db.add(JournalSettings(
            user_id=user_id,
            client_uuid=seed_uuid(user_id, "settings"),
            timezone=config.JOURNAL_DEFAULT_TIMEZONE,
            week_start=1,
            seed_version=SEED_VERSION,
            created_at=now,
            updated_at=now,
            server_rev=next_rev(state),
        ))
    else:
        # Будущие фазы досоздают свои стартовые наборы выше (категории, счёт) по номеру версии.
        existing.seed_version = SEED_VERSION
        existing.updated_at = now
        existing.server_rev = next_rev(state)
    await db.flush()
    return True
