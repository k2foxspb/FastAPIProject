from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.api.dependencies import get_async_db
from app.core.auth import get_current_production_user, get_current_owner, hash_password
from app.core.roles import (
    ScopedUser,
    ROLE_OWNER,
    ROLE_SHOP_CHIEF,
    ROLE_WORKER,
    PRODUCTION_ROLES,
    ROLE_LABELS_RU,
    get_role_scope,
    get_assignable_roles,
    can_assign_role,
    can_manage_user,
    can_move_worker,
)
from app.models.users import User as UserModel
from app.models.structure import Workshop as WorkshopModel, Section as SectionModel
from app.schemas.structure import (
    Workshop as WorkshopSchema,
    WorkshopCreate,
    WorkshopUpdate,
    Section as SectionSchema,
    SectionCreate,
    SectionUpdate,
    EmployeeCreate,
    EmployeeRoleUpdate,
    EmployeeAssignmentUpdate,
    EmployeeResponse,
    MoveWorkerRequest,
)

router = APIRouter(prefix="/org", tags=["organization"])


def _to_scoped(user: UserModel) -> ScopedUser:
    return ScopedUser(id=user.id, role=user.role, workshop_id=user.workshop_id, section_id=user.section_id)


# --- Справочная информация ---

@router.get("/roles/assignable")
async def get_assignable_roles_endpoint(
    current_user: UserModel = Depends(get_current_production_user),
):
    """Возвращает роли, которые текущий пользователь имеет право назначать."""
    roles = get_assignable_roles(current_user.role)
    return [{"value": r, "label": ROLE_LABELS_RU.get(r, r)} for r in roles]


# --- Цеха ---

@router.get("/workshops", response_model=list[WorkshopSchema])
async def list_workshops(
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Возвращает доступные пользователю цеха (владелец видит все, остальные - только свой)."""
    if current_user.role == ROLE_OWNER:
        result = await db.execute(select(WorkshopModel))
    elif current_user.workshop_id is not None:
        result = await db.execute(select(WorkshopModel).where(WorkshopModel.id == current_user.workshop_id))
    else:
        return []
    return result.scalars().all()


@router.post("/workshops", response_model=WorkshopSchema, status_code=status.HTTP_201_CREATED)
async def create_workshop(
    data: WorkshopCreate,
    owner: UserModel = Depends(get_current_owner),
    db: AsyncSession = Depends(get_async_db),
):
    """Создать цех. Доступно только владельцу."""
    workshop = WorkshopModel(name=data.name, description=data.description)
    db.add(workshop)
    await db.commit()
    await db.refresh(workshop)
    return workshop


@router.patch("/workshops/{workshop_id}", response_model=WorkshopSchema)
async def update_workshop(
    workshop_id: int,
    data: WorkshopUpdate,
    owner: UserModel = Depends(get_current_owner),
    db: AsyncSession = Depends(get_async_db),
):
    result = await db.execute(select(WorkshopModel).where(WorkshopModel.id == workshop_id))
    workshop = result.scalar_one_or_none()
    if not workshop:
        raise HTTPException(status_code=404, detail="Workshop not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(workshop, field, value)
    await db.commit()
    await db.refresh(workshop)
    return workshop


@router.delete("/workshops/{workshop_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workshop(
    workshop_id: int,
    owner: UserModel = Depends(get_current_owner),
    db: AsyncSession = Depends(get_async_db),
):
    result = await db.execute(select(WorkshopModel).where(WorkshopModel.id == workshop_id))
    workshop = result.scalar_one_or_none()
    if not workshop:
        raise HTTPException(status_code=404, detail="Workshop not found")
    await db.delete(workshop)
    await db.commit()
    return None


# --- Участки ---

@router.get("/sections", response_model=list[SectionSchema])
async def list_sections(
    workshop_id: int | None = None,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Возвращает доступные пользователю участки."""
    query = select(SectionModel)
    if current_user.role == ROLE_OWNER:
        if workshop_id is not None:
            query = query.where(SectionModel.workshop_id == workshop_id)
    elif current_user.role == ROLE_SHOP_CHIEF:
        if current_user.workshop_id is None:
            return []
        query = query.where(SectionModel.workshop_id == current_user.workshop_id)
    else:
        if current_user.section_id is None:
            return []
        query = query.where(SectionModel.id == current_user.section_id)

    result = await db.execute(query)
    return result.scalars().all()


async def _ensure_can_manage_workshop(current_user: UserModel, workshop_id: int):
    """Проверяет, что пользователь может управлять участками данного цеха."""
    if current_user.role == ROLE_OWNER:
        return
    if current_user.role == ROLE_SHOP_CHIEF and current_user.workshop_id == workshop_id:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions for this workshop")


@router.post("/sections", response_model=SectionSchema, status_code=status.HTTP_201_CREATED)
async def create_section(
    data: SectionCreate,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Создать участок. Доступно владельцу или начальнику соответствующего цеха."""
    await _ensure_can_manage_workshop(current_user, data.workshop_id)

    workshop_res = await db.execute(select(WorkshopModel).where(WorkshopModel.id == data.workshop_id))
    if not workshop_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Workshop not found")

    section = SectionModel(workshop_id=data.workshop_id, name=data.name, description=data.description)
    db.add(section)
    await db.commit()
    await db.refresh(section)
    return section


@router.patch("/sections/{section_id}", response_model=SectionSchema)
async def update_section(
    section_id: int,
    data: SectionUpdate,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    result = await db.execute(select(SectionModel).where(SectionModel.id == section_id))
    section = result.scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")

    await _ensure_can_manage_workshop(current_user, section.workshop_id)

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(section, field, value)
    await db.commit()
    await db.refresh(section)
    return section


@router.delete("/sections/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_section(
    section_id: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    result = await db.execute(select(SectionModel).where(SectionModel.id == section_id))
    section = result.scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")

    await _ensure_can_manage_workshop(current_user, section.workshop_id)

    await db.delete(section)
    await db.commit()
    return None


# --- Сотрудники ---

@router.get("/employees", response_model=list[EmployeeResponse])
async def list_employees(
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Возвращает сотрудников, видимых текущему пользователю (в его зоне ответственности)."""
    if current_user.role == ROLE_OWNER:
        result = await db.execute(select(UserModel).where(UserModel.role.in_(PRODUCTION_ROLES)))
    elif current_user.role == ROLE_SHOP_CHIEF:
        if current_user.workshop_id is None:
            return []
        result = await db.execute(
            select(UserModel).where(
                UserModel.role.in_(PRODUCTION_ROLES),
                UserModel.workshop_id == current_user.workshop_id,
            )
        )
    else:
        if current_user.section_id is None:
            return [EmployeeResponse.model_validate(current_user)]
        result = await db.execute(
            select(UserModel).where(
                UserModel.role.in_(PRODUCTION_ROLES),
                or_(UserModel.section_id == current_user.section_id, UserModel.id == current_user.id),
            )
        )
    return result.scalars().all()


async def _resolve_section_and_workshop(db: AsyncSession, section_id: int | None, workshop_id: int | None):
    """Определяет итоговые workshop_id/section_id по переданным данным, подгружая участок при необходимости."""
    resolved_workshop_id = workshop_id
    if section_id is not None:
        section_res = await db.execute(select(SectionModel).where(SectionModel.id == section_id))
        section = section_res.scalar_one_or_none()
        if not section:
            raise HTTPException(status_code=404, detail="Section not found")
        resolved_workshop_id = section.workshop_id
    return resolved_workshop_id, section_id


@router.post("/employees", response_model=EmployeeResponse, status_code=status.HTTP_201_CREATED)
async def create_employee(
    data: EmployeeCreate,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Создаёт нового сотрудника производственной иерархии.
    Пользователь может назначить только роль ниже своей и только в своей зоне ответственности.
    """
    if not can_assign_role(current_user.role, data.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot assign this role")

    if not data.email and not data.phone_number:
        raise HTTPException(status_code=400, detail="Email or phone number is required")

    resolved_workshop_id, resolved_section_id = await _resolve_section_and_workshop(
        db, data.section_id, data.workshop_id
    )

    target_scope = get_role_scope(data.role)
    if target_scope == "workshop" and resolved_workshop_id is None:
        raise HTTPException(status_code=400, detail="workshop_id is required for this role")
    if target_scope == "section" and resolved_section_id is None:
        raise HTTPException(status_code=400, detail="section_id is required for this role")

    # Проверка области ответственности текущего пользователя
    if current_user.role != ROLE_OWNER:
        if current_user.role == ROLE_SHOP_CHIEF:
            if resolved_workshop_id != current_user.workshop_id:
                raise HTTPException(status_code=403, detail="Outside of your workshop")
        else:
            if resolved_section_id != current_user.section_id:
                raise HTTPException(status_code=403, detail="Outside of your section")

    new_user = UserModel(
        email=data.email,
        phone_number=data.phone_number,
        hashed_password=hash_password(data.password),
        first_name=data.first_name,
        last_name=data.last_name,
        role=data.role,
        workshop_id=resolved_workshop_id,
        section_id=resolved_section_id,
        is_active=True,
    )
    db.add(new_user)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=400, detail="User with this email or phone number already exists")
    await db.refresh(new_user)
    return new_user


@router.patch("/employees/{user_id}/role", response_model=EmployeeResponse)
async def update_employee_role(
    user_id: int,
    data: EmployeeRoleUpdate,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Изменяет роль сотрудника с проверкой прав иерархии."""
    result = await db.execute(select(UserModel).where(UserModel.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if not can_manage_user(_to_scoped(current_user), _to_scoped(target)):
        raise HTTPException(status_code=403, detail="Not enough permissions to manage this user")

    if not can_assign_role(current_user.role, data.role):
        raise HTTPException(status_code=403, detail="You cannot assign this role")

    target.role = data.role
    await db.commit()
    await db.refresh(target)
    return target


@router.patch("/employees/{user_id}/assignment", response_model=EmployeeResponse)
async def update_employee_assignment(
    user_id: int,
    data: EmployeeAssignmentUpdate,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Назначает сотрудника в цех/участок с проверкой прав иерархии."""
    result = await db.execute(select(UserModel).where(UserModel.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if not can_manage_user(_to_scoped(current_user), _to_scoped(target)):
        raise HTTPException(status_code=403, detail="Not enough permissions to manage this user")

    resolved_workshop_id, resolved_section_id = await _resolve_section_and_workshop(
        db, data.section_id, data.workshop_id
    )

    if current_user.role != ROLE_OWNER:
        if current_user.role == ROLE_SHOP_CHIEF:
            if resolved_workshop_id != current_user.workshop_id:
                raise HTTPException(status_code=403, detail="Outside of your workshop")
        else:
            if resolved_section_id != current_user.section_id:
                raise HTTPException(status_code=403, detail="Outside of your section")

    target.workshop_id = resolved_workshop_id
    target.section_id = resolved_section_id
    await db.commit()
    await db.refresh(target)
    return target


@router.delete("/employees/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_employee(
    user_id: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Удаляет сотрудника с проверкой прав иерархии."""
    result = await db.execute(select(UserModel).where(UserModel.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if not can_manage_user(_to_scoped(current_user), _to_scoped(target)):
        raise HTTPException(status_code=403, detail="Not enough permissions to manage this user")

    await db.delete(target)
    await db.commit()
    return None


@router.post("/employees/{user_id}/move", response_model=EmployeeResponse)
async def move_worker(
    user_id: int,
    data: MoveWorkerRequest,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Перемещает рабочего на другой участок с проверкой прав иерархии."""
    result = await db.execute(select(UserModel).where(UserModel.id == user_id))
    worker = result.scalar_one_or_none()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    if worker.role != ROLE_WORKER:
        raise HTTPException(status_code=400, detail="Only workers can be moved between sections")

    section_res = await db.execute(select(SectionModel).where(SectionModel.id == data.section_id))
    target_section = section_res.scalar_one_or_none()
    if not target_section:
        raise HTTPException(status_code=404, detail="Target section not found")

    if not can_move_worker(
        _to_scoped(current_user), _to_scoped(worker), target_section.id, target_section.workshop_id
    ):
        raise HTTPException(status_code=403, detail="Not enough permissions to move this worker")

    worker.section_id = target_section.id
    worker.workshop_id = target_section.workshop_id
    await db.commit()
    await db.refresh(worker)
    return worker
