from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_async_db
from app.core.auth import get_current_user
from app.core.roles import (
    ROLE_OWNER,
    ROLE_WORKER,
    ROLE_ADMIN,
    ROLE_SHOP_CHIEF,
    ROLE_SECTION_CHIEF,
    ROLE_MASTER,
    ROLE_ASSISTANT_MASTER,
    get_production_roles,
    get_role_level,
)
from app.core.notifications import dispatch_notification
from app.api.routers.notifications import manager as notification_manager
from app.models.users import User as UserModel
from app.models.structure import Workshop as WorkshopModel, Section as SectionModel
from app.models.announcements import (
    Announcement as AnnouncementModel,
    AnnouncementRecipient as AnnouncementRecipientModel,
)
from app.schemas.announcements import (
    AnnouncementCreate,
    Announcement as AnnouncementSchema,
    AnnouncementRecipientAudit,
)

router = APIRouter(prefix="/announcements", tags=["announcements"])

ALLOWED_ANNOUNCEMENT_ROLES = {
    ROLE_OWNER,
    "admin",
    ROLE_SHOP_CHIEF,
    ROLE_SECTION_CHIEF,
    ROLE_MASTER,
    ROLE_ASSISTANT_MASTER,
}


async def _resolve_announcement_recipients(
    db: AsyncSession,
    author: UserModel,
    data: AnnouncementCreate,
) -> tuple[str, int | None, int | None, list[UserModel]]:
    """
    Разрешает зону ответственности и список получателей объявления строго вниз по иерархии:
    owner/admin → shop_chief → section_chief → master → assistant_master → worker

    Запрещена отправка вверх и горизонтально равным ролям вне подчиненности.
    """
    author_role = author.role
    if author_role == ROLE_WORKER or author_role not in ALLOWED_ANNOUNCEMENT_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Работники не могут создавать объявления",
        )

    target_workshop_id = data.target_workshop_id or data.workshop_id
    target_section_id = data.target_section_id or data.section_id
    target_role = data.target_role

    author_level = get_role_level(author_role)

    # Проверка роли адресации: нельзя адресовать наверх или равным
    if target_role:
        target_level = get_role_level(target_role)
        if target_level <= author_level and author_role not in (ROLE_OWNER, "admin"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Запрещена отправка вверх и горизонтально равным ролям",
            )

    scope_type = "global"
    resolved_workshop_id = None
    resolved_section_id = None

    if author_role in (ROLE_OWNER, "admin"):
        # admin/owner могут адресовать всем, либо сузить по цеху/участку/роли
        if target_section_id is not None:
            sec_res = await db.execute(select(SectionModel).where(SectionModel.id == target_section_id))
            section = sec_res.scalar_one_or_none()
            if not section:
                raise HTTPException(status_code=404, detail="Секция не найдена")
            scope_type = "section"
            resolved_workshop_id = section.workshop_id
            resolved_section_id = target_section_id
        elif target_workshop_id is not None:
            ws_res = await db.execute(select(WorkshopModel).where(WorkshopModel.id == target_workshop_id))
            workshop = ws_res.scalar_one_or_none()
            if not workshop:
                raise HTTPException(status_code=404, detail="Цех не найден")
            scope_type = "workshop"
            resolved_workshop_id = target_workshop_id
        else:
            scope_type = "global"

    elif author_role == ROLE_SHOP_CHIEF:
        # Начальник цеха — только внутри своего цеха
        if target_workshop_id is not None and target_workshop_id != author.workshop_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Начальник цеха может создавать объявления только внутри своего цеха",
            )
        resolved_workshop_id = author.workshop_id
        if target_section_id is not None:
            sec_res = await db.execute(
                select(SectionModel).where(
                    SectionModel.id == target_section_id,
                    SectionModel.workshop_id == author.workshop_id,
                )
            )
            section = sec_res.scalar_one_or_none()
            if not section:
                raise HTTPException(status_code=403, detail="Участок вне вашего цеха")
            scope_type = "section"
            resolved_section_id = target_section_id
        else:
            scope_type = "workshop"

    elif author_role == ROLE_SECTION_CHIEF:
        # Начальник участка — только внутри своего участка
        if target_workshop_id is not None and target_workshop_id != author.workshop_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Запрещено создавать объявления вне своего цеха",
            )
        if target_section_id is not None and target_section_id != author.section_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Начальник участка может создавать объявления только внутри своего участка",
            )
        scope_type = "section"
        resolved_workshop_id = author.workshop_id
        resolved_section_id = author.section_id

    elif author_role in (ROLE_MASTER, ROLE_ASSISTANT_MASTER):
        # Мастер/пом. мастера — только подчиненным в своей зоне
        if target_workshop_id is not None and target_workshop_id != author.workshop_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Запрещено создавать объявления вне своего цеха",
            )
        if target_section_id is not None and target_section_id != author.section_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Запрещено создавать объявления вне своего участка",
            )
        scope_type = "section"
        resolved_workshop_id = author.workshop_id
        resolved_section_id = author.section_id

    # Формируем запрос на подчиненных
    query = select(UserModel).where(
        UserModel.id != author.id,
        UserModel.is_active == True,
    )

    if resolved_workshop_id is not None:
        query = query.where(UserModel.workshop_id == resolved_workshop_id)
    if resolved_section_id is not None:
        query = query.where(UserModel.section_id == resolved_section_id)
    if target_role:
        query = query.where(UserModel.role == target_role)

    users_res = await db.execute(query)
    candidate_users = users_res.scalars().all()

    # Фильтрация строго вниз по иерархии (level подчиненного > level автора)
    recipients = []
    for u in candidate_users:
        u_level = get_role_level(u.role)
        if author_role in (ROLE_OWNER, "admin"):
            if u.role != ROLE_OWNER:
                recipients.append(u)
        else:
            if u_level > author_level:
                recipients.append(u)

    return scope_type, resolved_workshop_id, resolved_section_id, recipients


@router.post("/", response_model=AnnouncementSchema, status_code=status.HTTP_201_CREATED)
async def create_announcement(
    data: AnnouncementCreate,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Создает объявление и записи recipients строго вниз по иерархии.
    """
    scope_type, workshop_id, section_id, recipients = await _resolve_announcement_recipients(
        db, current_user, data
    )

    if not recipients:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нет доступных получателей для данного объявления",
        )

    announcement = AnnouncementModel(
        author_id=current_user.id,
        title=data.title,
        content=data.content,
        priority=data.priority or "normal",
        target_type=data.target_type,
        target_workshop_id=workshop_id,
        target_section_id=section_id,
        target_role=data.target_role,
        scope_type=scope_type,
        workshop_id=workshop_id,
        section_id=section_id,
        expires_at=data.expires_at,
        is_active=True,
    )
    db.add(announcement)
    await db.flush()

    for r in recipients:
        db.add(AnnouncementRecipientModel(
            announcement_id=announcement.id,
            user_id=r.id,
            is_read=False,
            read_at=None,
        ))

    await db.commit()

    # Загружаем связи для ответа
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
        "priority": announcement.priority,
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
    response.is_read = False
    return response


@router.get("/", response_model=list[AnnouncementSchema])
async def list_announcements(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Возвращает активные объявления, адресованные текущему пользователю или созданные им."""
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
    my_read_at_sub = (
        select(AnnouncementRecipientModel.read_at)
        .where(
            AnnouncementRecipientModel.announcement_id == AnnouncementModel.id,
            AnnouncementRecipientModel.user_id == current_user.id,
        )
        .scalar_subquery()
    )

    query = (
        select(AnnouncementModel, recipients_count_sub, my_is_read_sub, my_read_at_sub)
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
            AnnouncementModel.is_active == True,
            or_(
                AnnouncementModel.author_id == current_user.id,
                AnnouncementRecipientModel.user_id == current_user.id,
            ),
        )
        .order_by(AnnouncementModel.created_at.desc())
    )

    result = await db.execute(query)
    announcements = []
    for row in result.unique().all():
        item = AnnouncementSchema.model_validate(row[0])
        item.recipients_count = row[1] or 0
        if row[2] is not None:
            item.is_read = row[2]
            item.read_at = row[3]
        else:
            # Если автор сам смотрит созданное объявление
            item.is_read = True
            item.read_at = None
        announcements.append(item)
    return announcements


@router.post("/{announcement_id}/read")
async def mark_announcement_read(
    announcement_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Отмечает объявление как прочитанное текущим пользователем с фиксацией read_at."""
    result = await db.execute(
        select(AnnouncementRecipientModel).where(
            AnnouncementRecipientModel.announcement_id == announcement_id,
            AnnouncementRecipientModel.user_id == current_user.id,
        )
    )
    recipient = result.scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Announcement not found for this user")

    now = datetime.now(timezone.utc)
    recipient.is_read = True
    recipient.read_at = now
    await db.commit()
    return {"status": "ok", "is_read": True, "read_at": now}


@router.get("/{announcement_id}/recipients", response_model=list[AnnouncementRecipientAudit])
async def get_announcement_recipients(
    announcement_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Аудит доставки и прочтения для автора объявления или admin/owner."""
    ann_res = await db.execute(
        select(AnnouncementModel).where(AnnouncementModel.id == announcement_id)
    )
    announcement = ann_res.scalar_one_or_none()
    if not announcement:
        raise HTTPException(status_code=404, detail="Объявление не найдено")

    if announcement.author_id != current_user.id and current_user.role not in (ROLE_OWNER, "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ к аудиту получателей разрешен только автору или администратору",
        )

    rec_res = await db.execute(
        select(AnnouncementRecipientModel)
        .options(selectinload(AnnouncementRecipientModel.user))
        .where(AnnouncementRecipientModel.announcement_id == announcement_id)
        .order_by(AnnouncementRecipientModel.delivered_at.asc())
    )
    recipients = rec_res.scalars().all()
    return [AnnouncementRecipientAudit.model_validate(r) for r in recipients]


@router.delete("/{announcement_id}")
async def delete_announcement(
    announcement_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Мягкое удаление объявления (is_active = False) для автора или admin/owner."""
    ann_res = await db.execute(
        select(AnnouncementModel).where(AnnouncementModel.id == announcement_id)
    )
    announcement = ann_res.scalar_one_or_none()
    if not announcement:
        raise HTTPException(status_code=404, detail="Объявление не найдено")

    if announcement.author_id != current_user.id and current_user.role not in (ROLE_OWNER, "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Удаление разрешено только автору или администратору",
        )

    announcement.is_active = False
    await db.commit()
    return {"status": "ok"}
