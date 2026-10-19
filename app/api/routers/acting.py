import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.api.dependencies import get_async_db
from app.core.auth import get_current_production_user
from app.core.roles import (
    ScopedUser,
    ROLE_OWNER,
    can_assign_acting,
    get_role_scope,
)
from app.api.routers.notifications import manager as notification_manager
from app.core.fcm import send_fcm_notification
from app.models.users import User as UserModel
from app.models.structure import ActingAssignment as ActingAssignmentModel
from app.schemas.acting import ActingAssignmentCreate, ActingAssignmentResponse

router = APIRouter(prefix="/acting", tags=["acting"])


def _to_scoped(user: UserModel) -> ScopedUser:
    return ScopedUser(id=user.id, role=user.role, workshop_id=user.workshop_id, section_id=user.section_id)


def _in_zone(current_user: UserModel, workshop_id: int | None, section_id: int | None) -> bool:
    """Проверяет, что зона (цех/участок) замещаемой должности находится в зоне ответственности current_user."""
    if current_user.role == ROLE_OWNER:
        return True
    scope = get_role_scope(current_user.role)
    if scope == "global":
        return True
    if scope == "workshop":
        return current_user.workshop_id is not None and workshop_id == current_user.workshop_id
    if scope == "section":
        return current_user.section_id is not None and section_id == current_user.section_id
    return False


@router.post("/assignments", response_model=ActingAssignmentResponse, status_code=status.HTTP_201_CREATED)
async def create_acting_assignment(
    data: ActingAssignmentCreate,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Назначает пользователя исполняющим обязанности (и.о.) указанной
    должности. Замещается именно должность (acting_role) - её снимок, а не
    текущая должность конкретного человека, поэтому последующая смена
    должности replaced_user_id не влияет на уже выданное назначение.
    Назначать может только вышестоящий как над замещаемой должностью, так
    и над собственной должностью назначаемого и.о.
    """
    if data.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot appoint yourself as acting")

    result = await db.execute(select(UserModel).where(UserModel.id == data.user_id))
    assignee = result.scalar_one_or_none()
    if not assignee:
        raise HTTPException(status_code=404, detail="User not found")

    if not can_assign_acting(current_user.role, data.acting_role, assignee.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot appoint this acting assignment")

    replaced_user = None
    if data.replaced_user_id is not None:
        replaced_result = await db.execute(select(UserModel).where(UserModel.id == data.replaced_user_id))
        replaced_user = replaced_result.scalar_one_or_none()
        if not replaced_user:
            raise HTTPException(status_code=404, detail="Replaced user not found")

    # Зона ответственности замещаемой должности - снимок на момент создания.
    # Если не передана явно, по умолчанию берётся у замещаемого сотрудника.
    acting_workshop_id = data.acting_workshop_id
    acting_section_id = data.acting_section_id
    if replaced_user is not None:
        if acting_workshop_id is None:
            acting_workshop_id = replaced_user.workshop_id
        if acting_section_id is None:
            acting_section_id = replaced_user.section_id

    target_scope = get_role_scope(data.acting_role)
    if target_scope == "workshop" and acting_workshop_id is None:
        raise HTTPException(status_code=400, detail="acting_workshop_id is required for this role")
    if target_scope == "section" and acting_section_id is None:
        raise HTTPException(status_code=400, detail="acting_section_id is required for this role")

    if not _in_zone(current_user, acting_workshop_id, acting_section_id):
        raise HTTPException(status_code=403, detail="Outside of your zone of responsibility")

    starts_at = data.starts_at or datetime.now(timezone.utc)
    if data.ends_at is not None and data.ends_at <= starts_at:
        raise HTTPException(status_code=400, detail="ends_at must be after starts_at")

    assignment = ActingAssignmentModel(
        user_id=assignee.id,
        replaced_user_id=replaced_user.id if replaced_user else None,
        acting_role=data.acting_role,
        acting_workshop_id=acting_workshop_id,
        acting_section_id=acting_section_id,
        assigned_by_id=current_user.id,
        starts_at=starts_at,
        ends_at=data.ends_at,
        is_active=True,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    notified_users = [assignee] if replaced_user is None else [assignee, replaced_user]
    _notify_acting_change(notified_users, assignment, event="acting_assigned")

    return assignment


@router.get("/assignments", response_model=list[ActingAssignmentResponse])
async def list_acting_assignments(
    include_inactive: bool = False,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Возвращает назначения и.о., видимые текущему пользователю: в своей зоне
    ответственности (владелец видит все), а также собственные назначения
    (как назначающего или как и.о.).
    """
    query = select(ActingAssignmentModel)

    if current_user.role != ROLE_OWNER:
        scope = get_role_scope(current_user.role)
        own_filters = [
            ActingAssignmentModel.assigned_by_id == current_user.id,
            ActingAssignmentModel.user_id == current_user.id,
        ]
        if scope == "workshop" and current_user.workshop_id is not None:
            own_filters.append(ActingAssignmentModel.acting_workshop_id == current_user.workshop_id)
        elif scope == "section" and current_user.section_id is not None:
            own_filters.append(ActingAssignmentModel.acting_section_id == current_user.section_id)
        query = query.where(or_(*own_filters))

    if not include_inactive:
        now = datetime.now(timezone.utc)
        query = query.where(
            ActingAssignmentModel.is_active == True,  # noqa: E712
            ActingAssignmentModel.starts_at <= now,
            or_(ActingAssignmentModel.ends_at.is_(None), ActingAssignmentModel.ends_at >= now),
        )

    query = query.order_by(ActingAssignmentModel.created_at.desc())
    result = await db.execute(query)
    return result.scalars().all()


@router.delete("/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_acting_assignment(
    assignment_id: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Досрочно отзывает назначение и.о. Доступно вышестоящему над замещаемой должностью или назначившему её."""
    result = await db.execute(select(ActingAssignmentModel).where(ActingAssignmentModel.id == assignment_id))
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    is_owner = current_user.role == ROLE_OWNER
    is_creator = assignment.assigned_by_id == current_user.id
    can_manage_zone = _in_zone(current_user, assignment.acting_workshop_id, assignment.acting_section_id) and (
        can_assign_acting(current_user.role, assignment.acting_role, assignment.acting_role)
        or is_owner
    )
    if not (is_owner or is_creator or can_manage_zone):
        raise HTTPException(status_code=403, detail="Not enough permissions to revoke this assignment")

    assignment.is_active = False
    assignment.revoked_at = datetime.now(timezone.utc)
    await db.commit()

    notified_ids = {assignment.user_id}
    if assignment.replaced_user_id is not None:
        notified_ids.add(assignment.replaced_user_id)
    result = await db.execute(select(UserModel).where(UserModel.id.in_(notified_ids)))
    _notify_acting_change(result.scalars().all(), assignment, event="acting_revoked")

    return None


def _notify_acting_change(users: list[UserModel], assignment: ActingAssignmentModel, event: str) -> None:
    """Уведомляет и.о. и (если указан) замещаемого сотрудника об изменении назначения."""
    message = {
        "type": event,
        "assignment_id": assignment.id,
        "acting_role": assignment.acting_role,
    }
    title = "Назначение и.о." if event == "acting_assigned" else "Отзыв назначения и.о."
    body = "Вам назначена временная должность" if event == "acting_assigned" else "Временное назначение отозвано"
    for user in users:
        asyncio.create_task(notification_manager.send_personal_message(message, user.id))
        if user.fcm_token:
            asyncio.create_task(send_fcm_notification(
                token=user.fcm_token,
                title=title,
                body=body,
                data=message,
            ))
