from fastapi import Depends
from app.models.users import Friendship as FriendshipModel
from sqlalchemy import select
from collections.abc import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import async_session_maker

async def get_async_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Предоставляет асинхронную сессию SQLAlchemy для работы с базой данных PostgreSQL.
    """
    async with async_session_maker() as session:
        yield session


async def refresh_positions_cache_dep(db: AsyncSession = Depends(get_async_db)) -> None:
    """
    Перечитывает кэш должностей (app.core.roles) из БД перед обработкой запроса.

    Приложение в production запускается несколькими worker-процессами
    (gunicorn --workers N), а кэш должностей хранится в памяти каждого
    процесса отдельно. Из-за этого создание/изменение/удаление должности,
    обработанное одним воркером, не было видно остальным до их собственного
    вызова load_positions_cache - в результате только что добавленная
    должность могла оказаться недоступна для назначения сотруднику, если
    запрос на назначение попадал на другой воркер. Эта зависимость
    гарантирует, что кэш актуален перед любой проверкой иерархии ролей.
    """
    from app.core.roles import load_positions_cache
    await load_positions_cache(db)


async def get_friendship_status(user1_id_or_db, user2_id_or_user1, db_or_user2) -> str | None:
    """
    Возвращает статус дружбы между двумя пользователями.
    "accepted", "requested_by_me", "requested_by_them" или None.
    Поддерживает вызов как (user1_id, user2_id, db), так и (db, user1_id, user2_id).
    """
    if isinstance(user1_id_or_db, AsyncSession):
        db = user1_id_or_db
        user1_id = user2_id_or_user1
        user2_id = db_or_user2
    else:
        user1_id = user1_id_or_db
        user2_id = user2_id_or_user1
        db = db_or_user2

    if user1_id == user2_id:
        return "self"

    # Ищем среди отправленных user1
    res_sent = await db.execute(
        select(FriendshipModel).where(
            FriendshipModel.user_id == user1_id,
            FriendshipModel.friend_id == user2_id
        )
    )
    friendship = res_sent.scalar_one_or_none()
    if friendship:
        if friendship.status == "accepted":
            return "accepted"
        return "requested_by_me"

    # Ищем среди полученных user1
    res_received = await db.execute(
        select(FriendshipModel).where(
            FriendshipModel.user_id == user2_id,
            FriendshipModel.friend_id == user1_id
        )
    )
    friendship = res_received.scalar_one_or_none()
    if friendship:
        if friendship.status == "accepted":
            return "accepted"
        return "requested_by_them"

    return None


def can_view_content(owner_id: int, current_user_id: int | None, privacy: str, friendship_status: str | None) -> bool:
    """
    Проверяет, может ли пользователь просматривать контент.
    """
    if privacy == "public":
        return True
    if not current_user_id:
        return False
    if owner_id == current_user_id:
        return True
    if privacy == "friends":
        return friendship_status == "accepted"
    if privacy == "private":
        return owner_id == current_user_id
    return False