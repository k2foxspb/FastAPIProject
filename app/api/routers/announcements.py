from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_async_db
from app.core.auth import get_current_production_user
from app.core.roles import ROLE_OWNER, get_production_roles, ScopedUser, get_notification_scope_filter, get_role_level
from app.core.notifications import dispatch_notification
from app.api.routers.notifications import manager as notification_manager
from app.models.users import User as UserModel
from app.models.structure import Workshop as WorkshopModel, Section as SectionModel
from app.models.announcements import Announcement as AnnouncementModel, AnnouncementRecipient as AnnouncementRecipientModel
from app.schemas.announcements import AnnouncementCreate, Announcement as AnnouncementSchema

router = APIRouter(prefix="/announcements", tags=["announcements"])


async def _resolve_target_scope(
    db: AsyncSession,
    current_user: UserModel,
    target_workshop_id: int | None,
    target_section_id: int | None,
) -> tuple[str, int | None, int | None]:
    """
    Определяет фактическую группу получателей объявления с учётом выбора
    автора (target_workshop_id/target_section_id), но строго в границах его собственной
    зоны ответственности. Возвращает (scope_type, workshop_id, section_id).
    """
    scoped_current_user = ScopedUser(
        id=current_user.id,
        role=current_user.role,
        workshop_id=current_user.workshop_id,
        section_id=current_user.section_id,
    )
    own_scope_type, own_scope_value = get_notification_scope_filter(scoped_current_user)
    if own_scope_type is None:
        return "none", None, None

    if target_section_id is not None:
        result = await db.execute(select(SectionModel).where(SectionModel.id == target_section_id))
        section = result.scalar_one_or_none()
        if not section:
            raise HTTPException(status_code=404, detail="Section not found")
        if own_scope_type == "workshop" and section.workshop_id != own_scope_value:
            raise HTTPException(status_code=403, detail="Outside of your zone of responsibility")
        if own_scope_type == "section" and target_section_id != own_scope_value:
            raise HTTPException(status_code=403, detail="Outside of your zone of responsibility")
        return "section", section.workshop_id, target_section_id

    if target_workshop_id is not None:
        if own_scope_type == "section":
            raise HTTPException(status_code=403, detail="Outside of your zone of responsibility")
        result = await db.execute(select(WorkshopModel).where(WorkshopModel.id == target_workshop_id))
        workshop = result.scalar_one_or_none()
        if not workshop:
            raise HTTPException(status_code=404, detail="Workshop not found")
        if own_scope_type == "workshop" and target_workshop_id != own_scope_value:
            raise HTTPException(status_code=403, detail="Outside of your zone of responsibility")
        return "workshop", target_workshop_id, None

    # Выбор группы не задан - используем всю собственную зону ответственности автора.
    if own_scope_type == "global":
        return "global", None, None
    if own_scope_type == "workshop":
        return "workshop", own_scope_value, None
    if own_scope_type == "section":
        return "section", current_user.workshop_id, own_scope_value
    return "none", None, None


async def _get_recipients(
    db: AsyncSession, current_user: UserModel, scope_type: str, workshop_id: int | None, section_id: int | None
) -> list[UserModel]:
    """
    Возвращает список пользователей, которые должны получить уведомление об
    объявлении с уже разрешённой группой (scope_type/workshop_id/section_id).
    """
    query = select(UserModel).where(
        UserModel.role.in_(get_production_roles()),
        UserModel.id != current_user.id,
    )

    if scope_type == "global":
        # Владелец: уведомление получают все, кроме других владельцев
        query = query.where(UserModel.role != ROLE_OWNER)
    elif scope_type == "workshop":
        query = query.where(UserModel.workshop_id == workshop_id)
    elif scope_type == "section":
        query = query.where(UserModel.section_id == section_id)
    else:
        return []

    result = await db.execute(query)
    all_users = result.scalars().all()
    current_level = get_role_level(current_user.role)
    # Уведомление получают только пользователи СТРОГО ниже автора по иерархии
    return [u for u in all_users if get_role_level(u.role) > current_level]


@router.post("/", response_model=AnnouncementSchema, status_code=status.HTTP_201_CREATED)
async def create_announcement(
    data: AnnouncementCreate,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Публикует объявление. По умолчанию уведомление получают все пользователи ниже
    автора по иерархии в зоне его ответственности, но автор может явно сузить
    группу получателей до одного цеха/участка в пределах своей зоны через
    target_workshop_id/target_section_id. Рабочий не может публиковать объявления,
    так как у него нет подчинённых.
    """
    scope_type, workshop_id, section_id = await _resolve_target_scope(
        db, current_user, data.target_workshop_id, data.target_section_id
    )
    if scope_type == "none":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You have no subordinates to notify",
        )

    recipients = await _get_recipients(db, current_user, scope_type, workshop_id, section_id)

    announcement = AnnouncementModel(
        author_id=current_user.id,
        title=data.title,
        content=data.content,
        scope_type=scope_type,
        workshop_id=workshop_id,
        section_id=section_id,
    )
    db.add(announcement)
    await db.flush()

    for recipient in recipients:
        db.add(AnnouncementRecipientModel(announcement_id=announcement.id, user_id=recipient.id))

    await db.commit()

    result = await db.execute(
        select(AnnouncementModel)
        .options(
            selectinload(AnnouncementModel.author),
            selectinload(AnnouncementModel.workshop),
            selectinload(AnnouncementModel.section),
        )
        .where(AnnouncementModel.id == announcement.id)
    )
    announcement_obj = result.scalar_one()

    author_name = f"{current_user.first_name} {current_user.last_name}".strip() or current_user.email or current_user.phone_number
    notification_msg = {
        "type": "announcement",
        "announcement_id": announcement_obj.id,
        "author_id": current_user.id,
        "author_name": author_name,
        "title": data.title,
    }
    for recipient in recipients:
        dispatch_notification(
            recipient,
            group="announcements",
            title=f"Объявление: {author_name}",
            body=data.title if len(data.title) < 50 else f"{data.title[:47]}...",
            data=notification_msg,
            sender_id=current_user.id,
            ws_manager=notification_manager,
            ws_message=notification_msg,
        )

    response = AnnouncementSchema.model_validate(announcement_obj)
    response.recipients_count = len(recipients)
    return response


@router.get("/", response_model=list[AnnouncementSchema])
async def list_announcements(
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Возвращает объявления, адресованные текущему пользователю (и его собственные)."""
    recipients_count_sub = (
        select(func.count(AnnouncementRecipientModel.id))
        .where(AnnouncementRecipientModel.announcement_id == AnnouncementModel.id)
        .scalar_subquery()
    )
    my_is_read_sub = (
        select(AnnouncementRecipientModel.is_read)
        .where(
            AnnouncementRecipientModel.announcement_id == AnnouncementModel.id,
            AnnouncementRecipientModel.user_id == current_user.id,
        )
        .scalar_subquery()
    )

    query = (
        select(AnnouncementModel, recipients_count_sub, my_is_read_sub)
        .options(
            selectinload(AnnouncementModel.author),
            selectinload(AnnouncementModel.workshop),
            selectinload(AnnouncementModel.section),
        )
        .join(
            AnnouncementRecipientModel,
            (AnnouncementRecipientModel.announcement_id == AnnouncementModel.id)
            & (AnnouncementRecipientModel.user_id == current_user.id),
            isouter=True,
        )
        .where(
            (AnnouncementModel.author_id == current_user.id)
            | (AnnouncementRecipientModel.user_id == current_user.id)
        )
        .order_by(AnnouncementModel.created_at.desc())
    )

    result = await db.execute(query)
    announcements = []
    for row in result.unique().all():
        item = AnnouncementSchema.model_validate(row[0])
        item.recipients_count = row[1] or 0
        item.is_read = row[2]
        announcements.append(item)
    return announcements


@router.post("/{announcement_id}/read")
async def mark_announcement_read(
    announcement_id: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Отмечает объявление как прочитанное текущим пользователем."""
    result = await db.execute(
        select(AnnouncementRecipientModel).where(
            AnnouncementRecipientModel.announcement_id == announcement_id,
            AnnouncementRecipientModel.user_id == current_user.id,
        )
    )
    recipient = result.scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Announcement not found for this user")
    recipient.is_read = True
    await db.commit()
    return {"status": "ok"}
