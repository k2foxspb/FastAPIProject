import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_async_db
from app.core.auth import get_current_production_user
from app.core.production import can_review_production, find_all_supervisors
from app.core.roles import get_production_roles, get_role_scope, is_production_role
from app.api.routers.notifications import manager as notification_manager
from app.core.fcm import send_fcm_notification
from app.models.users import User as UserModel
from app.models.statements import (
    Statement as StatementModel,
    StatementApproval as StatementApprovalModel,
    StatementTemplate as StatementTemplateModel,
    StatementTemplateRecipient as StatementTemplateRecipientModel,
    STATEMENT_STATUS_PENDING,
    STATEMENT_STATUS_APPROVED,
    STATEMENT_STATUS_REJECTED,
    STATEMENT_APPROVAL_STATUS_NOTIFIED,
    STATEMENT_TEMPLATE_RECIPIENT_APPROVE,
    STATEMENT_TEMPLATE_RECIPIENT_NOTIFY,
)
from app.schemas.timesheet import EmployeeBrief
from app.schemas.statements import (
    StatementCreate,
    Statement as StatementSchema,
    StatementReject,
    StatementTemplateCreate,
    StatementTemplateUpdate,
    StatementTemplate as StatementTemplateSchema,
)

router = APIRouter(prefix="/statements", tags=["statements"])


def _can_manage_statement_templates(user: UserModel) -> bool:
    """
    Доступ к администрированию шаблонов заявлений - те же права, что открывают
    раздел орг-админки на мобильном фронте (см. canAccessOrgAdmin): владелец,
    админ, либо руководитель от уровня участка и выше (scope != 'self').
    """
    if user.role in ("admin", "owner"):
        return True
    return is_production_role(user.role) and get_role_scope(user.role) != "self"


def _require_statement_template_manager(current_user: UserModel = Depends(get_current_production_user)) -> UserModel:
    if not _can_manage_statement_templates(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return current_user


def _user_name(user: UserModel | None) -> str:
    if user is None:
        return ""
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or user.email or user.phone_number or f"#{user.id}"


async def _load_statement(db: AsyncSession, statement_id: int) -> StatementModel:
    result = await db.execute(
        select(StatementModel)
        .options(
            selectinload(StatementModel.author),
            selectinload(StatementModel.reviewer),
            selectinload(StatementModel.template),
            selectinload(StatementModel.approvals).selectinload(StatementApprovalModel.approver),
        )
        .where(StatementModel.id == statement_id)
    )
    statement = result.scalar_one_or_none()
    if not statement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Statement not found")
    return statement


def _statement_to_schema(statement: StatementModel) -> StatementSchema:
    schema = StatementSchema.model_validate(statement)
    schema.pending_approvers = [
        a.approver for a in statement.approvals
        if a.status == STATEMENT_STATUS_PENDING and a.approver is not None
    ]
    schema.template_name = statement.template.name if statement.template else None
    return schema


async def _load_statement_template(db: AsyncSession, template_id: int) -> StatementTemplateModel:
    result = await db.execute(
        select(StatementTemplateModel)
        .options(selectinload(StatementTemplateModel.recipients).selectinload(StatementTemplateRecipientModel.user))
        .where(StatementTemplateModel.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Statement template not found")
    return template


def _notify_about_statement(statement: StatementModel, approvers: list[UserModel], notify_only: list[UserModel]):
    """
    Уведомляет обязательных согласующих о новом заявлении, ожидающем
    согласования, а также руководителей, отмеченных только для уведомления -
    им ничего согласовывать не нужно, они просто информируются о заявлении.
    """
    author_name = _user_name(statement.author)
    body = f"{author_name}: {statement.message[:200]}"

    def _send(recipients: list[UserModel], message_type: str, title: str, requires_action: bool):
        if not recipients:
            return
        message = {
            "type": message_type,
            "statement_id": statement.id,
            "author_id": statement.author_id,
            "author_name": author_name,
            "message": statement.message,
            "requires_action": requires_action,
        }
        for recipient in recipients:
            asyncio.create_task(notification_manager.send_personal_message(message, recipient.id))
            if recipient.fcm_token:
                asyncio.create_task(send_fcm_notification(
                    token=recipient.fcm_token,
                    title=title,
                    body=body,
                    data=message,
                    sender_id=statement.author_id,
                ))

    _send(approvers, "statement_submitted", "Новое заявление на согласовании", requires_action=True)
    _send(notify_only, "statement_notified", "Новое заявление (уведомление)", requires_action=False)


def _notify_author_about_review(statement: StatementModel, approved: bool):
    """Уведомляет автора заявления о результате согласования."""
    message = {
        "type": "statement_approved" if approved else "statement_rejected",
        "statement_id": statement.id,
        "comment": statement.reviewer_comment,
    }
    asyncio.create_task(notification_manager.send_personal_message(message, statement.author_id))
    if statement.author and statement.author.fcm_token:
        asyncio.create_task(send_fcm_notification(
            token=statement.author.fcm_token,
            title="Заявление согласовано" if approved else "Заявление отклонено",
            body=statement.message[:200],
            data=message,
            sender_id=statement.reviewer_id,
        ))


@router.get("/supervisors", response_model=list[EmployeeBrief])
async def get_statement_supervisors(
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Возвращает всю цепочку вышестоящих руководителей текущего пользователя -
    список для чекбоксов на экране создания заявления, чтобы выбрать, кого
    назначить согласующим, а кого просто уведомить.
    """
    return await find_all_supervisors(db, current_user)


# ------------------------------------------------------------------
# Шаблоны заявлений (настраиваются администратором)
# ------------------------------------------------------------------

@router.get("/templates", response_model=list[StatementTemplateSchema])
async def list_statement_templates(
    include_inactive: bool = False,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Список шаблонов заявлений. Обычным сотрудникам (для выбора шаблона в
    форме заявления) всегда отдаются только активные шаблоны; просмотр
    неактивных (include_inactive=True) доступен только тем, кто может
    администрировать шаблоны.
    """
    query = select(StatementTemplateModel).options(
        selectinload(StatementTemplateModel.recipients).selectinload(StatementTemplateRecipientModel.user)
    )
    if not include_inactive or not _can_manage_statement_templates(current_user):
        query = query.where(StatementTemplateModel.is_active == True)
    query = query.order_by(StatementTemplateModel.name.asc())
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/templates/candidates", response_model=list[EmployeeBrief])
async def get_statement_template_candidates(
    current_user: UserModel = Depends(_require_statement_template_manager),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Список пользователей производственной иерархии, из которых администратор
    может выбрать обязательных согласующих и уведомляемых для шаблона
    заявления (в отличие от свободного заявления - не ограничен цепочкой
    руководителей конкретного сотрудника).
    """
    result = await db.execute(
        select(UserModel)
        .where(UserModel.role.in_(get_production_roles()), UserModel.is_active == True)
        .order_by(UserModel.last_name.asc(), UserModel.first_name.asc())
    )
    return result.scalars().all()


def _apply_template_recipients(db: AsyncSession, template: StatementTemplateModel, approver_user_ids: list[int], notify_user_ids: list[int]) -> None:
    approver_ids = set(approver_user_ids)
    notify_ids = set(notify_user_ids) - approver_ids
    for user_id in approver_ids:
        db.add(StatementTemplateRecipientModel(template_id=template.id, user_id=user_id, role=STATEMENT_TEMPLATE_RECIPIENT_APPROVE))
    for user_id in notify_ids:
        db.add(StatementTemplateRecipientModel(template_id=template.id, user_id=user_id, role=STATEMENT_TEMPLATE_RECIPIENT_NOTIFY))


@router.post("/templates", response_model=StatementTemplateSchema, status_code=status.HTTP_201_CREATED)
async def create_statement_template(
    data: StatementTemplateCreate,
    current_user: UserModel = Depends(_require_statement_template_manager),
    db: AsyncSession = Depends(get_async_db),
):
    """Создаёт шаблон заявления с заранее настроенными обязательными согласующими и уведомляемыми."""
    if not data.approver_user_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Необходимо выбрать хотя бы одного обязательного согласующего",
        )

    template = StatementTemplateModel(
        name=data.name,
        default_message=data.default_message,
        is_active=data.is_active,
    )
    db.add(template)
    await db.flush()

    _apply_template_recipients(db, template, data.approver_user_ids, data.notify_user_ids)
    await db.commit()

    return await _load_statement_template(db, template.id)


@router.put("/templates/{template_id}", response_model=StatementTemplateSchema)
async def update_statement_template(
    template_id: int,
    data: StatementTemplateUpdate,
    current_user: UserModel = Depends(_require_statement_template_manager),
    db: AsyncSession = Depends(get_async_db),
):
    """Обновляет шаблон заявления; списки согласующих/уведомляемых заменяются целиком, если переданы."""
    template = await _load_statement_template(db, template_id)

    if data.name is not None:
        template.name = data.name
    if data.default_message is not None:
        template.default_message = data.default_message
    if data.is_active is not None:
        template.is_active = data.is_active

    if data.approver_user_ids is not None or data.notify_user_ids is not None:
        new_approver_ids = data.approver_user_ids if data.approver_user_ids is not None else [
            r.user_id for r in template.recipients if r.role == STATEMENT_TEMPLATE_RECIPIENT_APPROVE
        ]
        new_notify_ids = data.notify_user_ids if data.notify_user_ids is not None else [
            r.user_id for r in template.recipients if r.role == STATEMENT_TEMPLATE_RECIPIENT_NOTIFY
        ]
        if not new_approver_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Необходимо выбрать хотя бы одного обязательного согласующего",
            )
        await db.execute(
            StatementTemplateRecipientModel.__table__.delete().where(
                StatementTemplateRecipientModel.template_id == template.id
            )
        )
        await db.flush()
        _apply_template_recipients(db, template, new_approver_ids, new_notify_ids)

    await db.commit()
    return await _load_statement_template(db, template.id)


@router.delete("/templates/{template_id}")
async def delete_statement_template(
    template_id: int,
    current_user: UserModel = Depends(_require_statement_template_manager),
    db: AsyncSession = Depends(get_async_db),
):
    """Деактивирует шаблон (мягкое удаление, чтобы не потерять историю уже поданных по нему заявлений)."""
    template = await _load_statement_template(db, template_id)
    template.is_active = False
    await db.commit()
    return {"status": "ok"}


@router.post("", response_model=StatementSchema)
async def create_statement(
    data: StatementCreate,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Создаёт новое заявление от текущего пользователя. Если указан template_id,
    обязательные согласующие и уведомляемые берутся из настроек шаблона
    (заданы администратором); иначе используется ручной выбор галочками -
    все выбранные согласующие должны согласовать заявление (отказ любого
    отклоняет его целиком), дополнительно выбранные руководители просто
    уведомляются, без необходимости согласования.
    """
    template: StatementTemplateModel | None = None
    if data.template_id is not None:
        template = await _load_statement_template(db, data.template_id)
        if not template.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Statement template is not active")
        approvers = [r.user for r in template.recipients if r.role == STATEMENT_TEMPLATE_RECIPIENT_APPROVE and r.user is not None]
        notify_only = [r.user for r in template.recipients if r.role == STATEMENT_TEMPLATE_RECIPIENT_NOTIFY and r.user is not None]
        if not approvers:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="В выбранном шаблоне не настроено ни одного согласующего",
            )
    else:
        all_supervisors = await find_all_supervisors(db, current_user)
        supervisors_by_id = {s.id: s for s in all_supervisors}

        approver_ids = set(data.approver_user_ids)
        approvers = [supervisors_by_id[uid] for uid in approver_ids if uid in supervisors_by_id]
        if not approvers:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Необходимо выбрать хотя бы одного согласующего из числа вышестоящих руководителей",
            )

        notify_ids = set(data.notify_user_ids) - approver_ids
        notify_only = [supervisors_by_id[uid] for uid in notify_ids if uid in supervisors_by_id]

    statement = StatementModel(
        author_id=current_user.id,
        template_id=template.id if template else None,
        message=data.message,
        status=STATEMENT_STATUS_PENDING,
    )
    db.add(statement)
    await db.flush()

    for approver in approvers:
        db.add(StatementApprovalModel(
            statement_id=statement.id,
            approver_id=approver.id,
            status=STATEMENT_STATUS_PENDING,
        ))
    for recipient in notify_only:
        db.add(StatementApprovalModel(
            statement_id=statement.id,
            approver_id=recipient.id,
            status=STATEMENT_APPROVAL_STATUS_NOTIFIED,
            decided_at=datetime.now(timezone.utc),
        ))

    await db.commit()

    statement = await _load_statement(db, statement.id)
    _notify_about_statement(statement, approvers, notify_only)
    return _statement_to_schema(statement)


@router.get("/my", response_model=list[StatementSchema])
async def list_my_statements(
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Список заявлений, созданных текущим пользователем."""
    result = await db.execute(
        select(StatementModel)
        .options(
            selectinload(StatementModel.author),
            selectinload(StatementModel.reviewer),
            selectinload(StatementModel.template),
            selectinload(StatementModel.approvals).selectinload(StatementApprovalModel.approver),
        )
        .where(StatementModel.author_id == current_user.id)
        .order_by(StatementModel.created_at.desc())
    )
    statements = result.scalars().all()
    return [_statement_to_schema(s) for s in statements]


@router.get("/pending", response_model=list[StatementSchema])
async def list_pending_statements(
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Заявления, ожидающие собственного согласования текущего пользователя -
    он назначен одним из обязательных согласующих и ещё не принял решение.
    Согласующий, назначенный через шаблон, может не быть прямым
    руководителем автора по иерархии - достаточно самого факта назначения.
    """
    result = await db.execute(
        select(StatementModel)
        .options(
            selectinload(StatementModel.author),
            selectinload(StatementModel.template),
            selectinload(StatementModel.approvals).selectinload(StatementApprovalModel.approver),
        )
        .where(StatementModel.status == STATEMENT_STATUS_PENDING)
        .order_by(StatementModel.created_at.asc())
    )
    statements = result.scalars().all()
    visible = [
        s for s in statements
        if any(
            a.approver_id == current_user.id and a.status == STATEMENT_STATUS_PENDING
            for a in s.approvals
        )
    ]
    return [_statement_to_schema(s) for s in visible]


@router.get("/{statement_id}", response_model=StatementSchema)
async def get_statement_detail(
    statement_id: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Карточка заявления - доступна автору, всем назначенным согласующим/
    уведомляемым (в том числе назначенным через шаблон, а не только через
    иерархию), а также тем, кто может согласовывать автора по иерархии.
    """
    statement = await _load_statement(db, statement_id)
    is_participant = statement.author_id == current_user.id or any(
        a.approver_id == current_user.id for a in statement.approvals
    )
    if not is_participant and not can_review_production(current_user, statement.author):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return _statement_to_schema(statement)


@router.post("/{statement_id}/approve", response_model=StatementSchema)
async def approve_statement(
    statement_id: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Подтверждает свою часть согласования заявления. Если согласующих
    несколько, заявление переходит в "approved" только когда согласуют ВСЕ.
    """
    statement = await _load_statement(db, statement_id)
    if statement.status != STATEMENT_STATUS_PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Statement is not pending approval")

    approval = next(
        (a for a in statement.approvals if a.approver_id == current_user.id and a.status == STATEMENT_STATUS_PENDING),
        None,
    )
    if approval is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not assigned to approve this statement")

    approval.status = STATEMENT_STATUS_APPROVED
    approval.decided_at = datetime.now(timezone.utc)
    approval.comment = None
    await db.flush()

    fully_approved = not any(a.status == STATEMENT_STATUS_PENDING for a in statement.approvals)
    if fully_approved:
        statement.status = STATEMENT_STATUS_APPROVED
        statement.reviewer_id = current_user.id
        statement.reviewed_at = datetime.now(timezone.utc)
        statement.reviewer_comment = None
    await db.commit()

    statement = await _load_statement(db, statement.id)
    if fully_approved:
        _notify_author_about_review(statement, approved=True)
    return _statement_to_schema(statement)


@router.post("/{statement_id}/reject", response_model=StatementSchema)
async def reject_statement(
    statement_id: int,
    data: StatementReject,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Отклоняет заявление - комментарий обязателен. Отказ любого согласующего отклоняет заявление целиком."""
    statement = await _load_statement(db, statement_id)
    if statement.status != STATEMENT_STATUS_PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Statement is not pending approval")

    approval = next(
        (a for a in statement.approvals if a.approver_id == current_user.id and a.status == STATEMENT_STATUS_PENDING),
        None,
    )
    if approval is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not assigned to approve this statement")

    approval.status = STATEMENT_STATUS_REJECTED
    approval.decided_at = datetime.now(timezone.utc)
    approval.comment = data.comment

    statement.status = STATEMENT_STATUS_REJECTED
    statement.reviewer_id = current_user.id
    statement.reviewed_at = datetime.now(timezone.utc)
    statement.reviewer_comment = data.comment
    await db.commit()

    statement = await _load_statement(db, statement.id)
    _notify_author_about_review(statement, approved=False)
    return _statement_to_schema(statement)
