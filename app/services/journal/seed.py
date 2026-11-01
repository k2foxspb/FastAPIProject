"""
Стартовые наборы журнала.

Идентификаторы стартовых записей детерминированы (UUIDv5 от user_id и ключа),
поэтому клиент может создать их локально даже офлайн, а сервер - при первой
синхронизации: upsert по одному и тому же UUID идемпотентен, дублей не будет.
Набор создаётся один раз - версия хранится в journal_settings.seed_version.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config
from app.models.journal import JournalSettings
from app.models.journal.base import utcnow

# Пространство имён UUIDv5 журнала (то же значение используется в mobile/src/journal/utils/seed.js).
NS_JOURNAL = uuid.UUID("6f2c1a3e-8d4b-4f7a-9c1e-2b5d7e9f0a13")
SEED_VERSION = 1

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


async def ensure_seed(db: AsyncSession, user_id: int) -> bool:
    """
    Создаёт стартовые записи пользователя, если их ещё нет. Возвращает True,
    если что-то было создано (вызывающий код делает commit).
    """
    from app.services.journal.sync_service import lock_state, next_rev

    existing = (await db.execute(
        select(JournalSettings).where(JournalSettings.user_id == user_id)
    )).scalar_one_or_none()
    if existing is not None and existing.seed_version >= SEED_VERSION:
        return False

    state = await lock_state(db, user_id)
    now = utcnow()
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
        # Здесь будущие фазы досоздают свои стартовые наборы (типы приёмов пищи, категории, счёт).
        existing.seed_version = SEED_VERSION
        existing.updated_at = now
        existing.server_rev = next_rev(state)
    await db.flush()
    return True
