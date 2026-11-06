"""
Сервисный слой для создания уведомлений (колокольчик в приложении) и их
группировки (чтобы не плодить по одной записи на каждый лайк/комментарий).

Любой код, создающий уведомление пользователю, должен использовать
create_or_group_notification() вместо прямой работы с моделью Notification,
чтобы группировка и рассылка в реальном времени работали одинаково везде.
"""
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notifications import Notification
from app.models.users import User as UserModel
from app.core.notifications import dispatch_notification, dispatch_system_notification
from app.schemas.users import get_default_avatar_url


# Группы оповещений (NOTIFICATION_GROUPS), которые всегда отправляются
# неотключаемо через dispatch_system_notification.
_ALWAYS_ON_NOTIF_TYPES = {"announcement", "system", "app_update"}

# Соответствие notif_type -> группа настроек уведомлений (app.core.notifications.NOTIFICATION_GROUPS)
# Тип push (data.type), который видит клиент, если вызывающий код не задал свой в data.
# Клиент маршрутизирует все эти типы в колокольчик (см. app.core.fcm.get_push_route).
_NOTIF_TYPE_TO_PUSH_TYPE = {
    "announcement": "announcement",
    "app_update": "app_update",
    "friend_request": "friend_request",
    "friend_accepted": "friend_accepted",
    "friend_post": "news_post",
    "journal_summary": "journal_summary",
}

_NOTIF_TYPE_TO_GROUP = {
    "post_like": "friend_posts",
    "post_comment": "friend_posts",
    "friend_request": "friends",
    "friend_accepted": "friends",
    "friend_post": "friend_posts",
    "post_moderated": "friend_posts",
    "announcement": "announcements",
    "system": "announcements",
    "app_update": "announcements",
    "news_reaction": "news",
    "news_comment": "news",
    "album_reaction": "photos_albums",
    "album_comment": "photos_albums",
    "album_comment_reaction": "photos_albums",
    "photo_reaction": "photos_albums",
    "photo_comment": "photos_albums",
    "photo_comment_reaction": "photos_albums",
    "journal_summary": "journal",
}


async def create_or_group_notification(
    db: AsyncSession,
    user_id: int,
    notif_type: str,
    title: str,
    body: str | None = None,
    data: Optional[dict] = None,
    actor_id: Optional[int] = None,
    group_key: Optional[str] = None,
    is_unremovable: bool = False,
) -> Notification:
    """
    Создаёт уведомление пользователю user_id, либо, если передан group_key и
    уже существует непрочитанное уведомление с таким user_id+group_key+notif_type,
    обновляет его (увеличивает count, обновляет title/body/updated_at) -
    используется для агрегации однотипных событий об одном объекте
    (например "5 пользователей поставили лайк вашему посту").

    Коммитит изменения в БД и рассылает push/websocket-уведомление в реальном
    времени через app.core.notifications.dispatch_notification (или
    dispatch_system_notification для неотключаемых групп).
    """
    notification: Notification | None = None

    if group_key:
        result = await db.execute(
            select(Notification).where(
                Notification.user_id == user_id,
                Notification.group_key == group_key,
                Notification.notif_type == notif_type,
                Notification.is_read == False,
            )
        )
        notification = result.scalar_one_or_none()

    if notification:
        notification.count += 1
        notification.title = title
        if body is not None:
            notification.body = body
        if data is not None:
            notification.data = data
        if actor_id is not None:
            notification.actor_id = actor_id
    else:
        notification = Notification(
            user_id=user_id,
            actor_id=actor_id,
            notif_type=notif_type,
            title=title,
            body=body,
            group_key=group_key,
            data=data,
            count=1,
            is_unremovable=is_unremovable,
        )
        db.add(notification)

    await db.commit()
    await db.refresh(notification)

    # Рассылаем push/websocket в реальном времени, не блокируя основной поток
    try:
        result = await db.execute(select(UserModel).where(UserModel.id == user_id))
        user = result.scalar_one_or_none()
        if user is not None:
            from app.api.routers.notifications import manager as ws_manager

            ws_message = {
                "type": "notification",
                "data": {
                    "id": notification.id,
                    "notif_type": notification.notif_type,
                    "title": notification.title,
                    "body": notification.body,
                    "count": notification.count,
                    "is_read": notification.is_read,
                    "data": notification.data,
                },
            }

            group = _NOTIF_TYPE_TO_GROUP.get(notif_type, "announcements")

            # Данные автора события (аватарка/имя) для push; тип push задаём явно,
            # иначе fcm.py подставит "new_message" и клиент засчитает его как сообщение чата.
            sender_avatar = None
            push_data = dict(data or {})
            push_data.setdefault("type", _NOTIF_TYPE_TO_PUSH_TYPE.get(notif_type, notif_type))
            push_data["notification_id"] = notification.id
            if actor_id is not None:
                actor = await db.get(UserModel, actor_id)
                if actor is not None:
                    sender_avatar = actor.avatar_preview_url or actor.avatar_url or get_default_avatar_url(actor.gender)
                    actor_name = f"{actor.first_name or ''} {actor.last_name or ''}".strip() or actor.email
                    if actor_name:
                        push_data.setdefault("sender_name", actor_name)

            if notif_type in _ALWAYS_ON_NOTIF_TYPES:
                dispatch_system_notification(
                    user,
                    title=title,
                    body=body or "",
                    data=push_data,
                    sender_id=actor_id,
                    sender_avatar=sender_avatar,
                    ws_manager=ws_manager,
                    ws_message=ws_message,
                )
            else:
                dispatch_notification(
                    user,
                    group=group,
                    title=title,
                    body=body or "",
                    data=push_data,
                    sender_id=actor_id,
                    sender_avatar=sender_avatar,
                    ws_manager=ws_manager,
                    ws_message=ws_message,
                )
    except Exception:
        # Ошибка доставки real-time уведомления не должна ломать основную операцию
        from loguru import logger
        logger.exception("Failed to dispatch real-time notification")

    return notification
