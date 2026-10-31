from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_async_db
from app.core.auth import get_current_user
from app.models.notifications import Notification
from app.models.users import User as UserModel
from app.schemas.notifications import NotificationResponse, NotificationListResponse

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListResponse)
@router.get("/", response_model=NotificationListResponse, include_in_schema=False)
async def list_notifications(
    skip: int = 0,
    limit: int = 30,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Возвращает уведомления текущего пользователя, отсортированные по дате
    последнего обновления (новые/обновлённые сверху), с пагинацией.
    """
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == current_user.id)
        .options(selectinload(Notification.actor))
        .order_by(Notification.updated_at.desc())
        .offset(skip)
        .limit(limit)
    )
    items = result.scalars().all()

    unread_result = await db.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == current_user.id,
            Notification.is_read == False,
        )
    )
    unread_count = unread_result.scalar() or 0

    return NotificationListResponse(
        items=[NotificationResponse.model_validate(n) for n in items],
        unread_count=unread_count,
    )


@router.get("/unread-count")
async def get_unread_count(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Возвращает количество непрочитанных уведомлений текущего пользователя."""
    result = await db.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == current_user.id,
            Notification.is_read == False,
        )
    )
    return {"count": result.scalar() or 0}


@router.post("/{notification_id}/read", response_model=NotificationResponse)
async def mark_notification_read(
    notification_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Отмечает одно уведомление как прочитанное."""
    result = await db.execute(
        select(Notification)
        .where(Notification.id == notification_id, Notification.user_id == current_user.id)
        .options(selectinload(Notification.actor))
    )
    notification = result.scalar_one_or_none()
    if not notification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")

    if not notification.is_read:
        notification.is_read = True
        await db.commit()
        await db.refresh(notification)

    return NotificationResponse.model_validate(notification)


@router.post("/read-all")
async def mark_all_notifications_read(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Отмечает все уведомления текущего пользователя как прочитанные."""
    await db.execute(
        update(Notification)
        .where(Notification.user_id == current_user.id, Notification.is_read == False)
        .values(is_read=True)
    )
    await db.commit()
    return {"message": "All notifications marked as read"}
