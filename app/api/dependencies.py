from sqlalchemy.orm import Session, selectinload
from collections.abc import Generator, AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import async_session_maker, SessionLocal
from app.models.users import User as UserModel, Friendship as FriendshipModel
from sqlalchemy import select


def get_db() -> Generator[Session, None, None]:
    """
    Зависимость для получения сессии базы данных.
    Создаёт новую сессию для каждого запроса и закрывает её после обработки.
    """
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()



# --------------- Асинхронная сессия -------------------------

from collections.abc import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import async_session_maker

async def get_async_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Предоставляет асинхронную сессию SQLAlchemy для работы с базой данных PostgreSQL.
    """
    async with async_session_maker() as session:
        yield session


async def get_friendship_status(user1_id: int, user2_id: int, db: AsyncSession) -> str | None:
    """
    Возвращает статус дружбы между двумя пользователями.
    "accepted", "requested_by_me", "requested_by_them" или None.
    """
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