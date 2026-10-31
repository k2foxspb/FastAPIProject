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


# Группы оповещений (NOTIFICATION_GROUPS), которые всегда отправляются
# неотключаемо через dispatch_system_notification.
_ALWAYS_ON_NOTIF_TYPES = {"announcement", "system"}

# Соответствие notif_type -> группа настроек уведомлений (app.core.notifications.NOTIFICATION_GROUPS)
_NOTIF_TYPE_TO_GROUP = {
    "post_like": "friend_posts",
    "post_comment": "friend_posts",
    "friend_request": "friends",
    "friend_accepted": "friends",
    "friend_post": "friend_posts",
    "post_moderated": "friend_posts",
    "announcement": "announcements",
    "system": "announcements",
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
            if notif_type in _ALWAYS_ON_NOTIF_TYPES:
                dispatch_system_notification(
                    user,
                    title=title,
                    body=body or "",
                    data=data,
                    sender_id=actor_id,
                    ws_manager=ws_manager,
                    ws_message=ws_message,
                )
            else:
                dispatch_notification(
                    user,
                    group=group,
                    title=title,
                    body=body or "",
                    data=data,
                    sender_id=actor_id,
                    ws_manager=ws_manager,
                    ws_message=ws_message,
                )
    except Exception:
        # Ошибка доставки real-time уведомления не должна ломать основную операцию
        from loguru import logger
        logger.exception("Failed to dispatch real-time notification")

    return notification
