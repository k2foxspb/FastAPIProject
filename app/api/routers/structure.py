from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func

from app.api.dependencies import get_async_db
from app.core.auth import get_current_production_user, get_current_owner, hash_password
from app.core.roles import (
    ScopedUser,
    ROLE_OWNER,
    ROLE_SHOP_CHIEF,
    ROLE_WORKER,
    get_production_roles,
    get_role_label,
    is_production_role,
    get_role_scope,
    get_role_level,
    get_assignable_roles,
    can_assign_role,
    can_manage_user,
    can_move_worker,
    can_view_user,
    load_positions_cache,
)
from app.models.users import User as UserModel
from app.models.structure import Workshop as WorkshopModel, Section as SectionModel, Position as PositionModel
from app.schemas.structure import (
    Workshop as WorkshopSchema,
    WorkshopCreate,
    WorkshopUpdate,
    Section as SectionSchema,
    SectionCreate,
    SectionUpdate,
    EmployeeCreate,
    EmployeeAssign,
    EmployeeRoleUpdate,
    EmployeeAssignmentUpdate,
    EmployeeResponse,
    EmployeeHierarchyResponse,
    MoveWorkerRequest,
    Position as PositionSchema,
    PositionCreate,
    PositionUpdate,
    PositionReorderRequest,
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
    return [{"value": r, "label": get_role_label(r)} for r in roles]


# --- Должности ---

@router.get("/positions", response_model=list[PositionSchema])
async def list_positions(
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Возвращает все должности производственной иерархии, отсортированные по уровню."""
    result = await db.execute(select(PositionModel).order_by(PositionModel.level.asc()))
    return result.scalars().all()


@router.post("/positions", response_model=PositionSchema, status_code=status.HTTP_201_CREATED)
async def create_position(
    data: PositionCreate,
    owner: UserModel = Depends(get_current_owner),
    db: AsyncSession = Depends(get_async_db),
):
    """Создаёт новую должность. Доступно только владельцу."""
    if data.scope not in ("global", "workshop", "section", "self"):
        raise HTTPException(status_code=400, detail="Invalid scope")

    existing = await db.execute(select(PositionModel).where(PositionModel.code == data.code))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Position with this code already exists")

    level = data.level
    if level is None:
        max_level_res = await db.execute(select(func.max(PositionModel.level)))
        max_level = max_level_res.scalar()
        level = (max_level if max_level is not None else -1) + 1
    else:
        level_taken = await db.execute(select(PositionModel).where(PositionModel.level == level))
        if level_taken.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="A position with this level already exists")

    position = PositionModel(code=data.code, name=data.name, level=level, scope=data.scope, is_system=False)
    db.add(position)
    await db.commit()
    await db.refresh(position)
    await load_positions_cache(db)
    return position


@router.patch("/positions/{position_id}", response_model=PositionSchema)
async def update_position(
    position_id: int,
    data: PositionUpdate,
    owner: UserModel = Depends(get_current_owner),
    db: AsyncSession = Depends(get_async_db),
):
    """Переименовывает должность или меняет её область ответственности/уровень. Код изменить нельзя."""
    result = await db.execute(select(PositionModel).where(PositionModel.id == position_id))
    position = result.scalar_one_or_none()
    if not position:
        raise HTTPException(status_code=404, detail="Position not found")

    if data.scope is not None and data.scope not in ("global", "workshop", "section", "self"):
        raise HTTPException(status_code=400, detail="Invalid scope")

    if data.level is not None and data.level != position.level:
        level_taken = await db.execute(
            select(PositionModel).where(PositionModel.level == data.level, PositionModel.id != position_id)
        )
        if level_taken.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="A position with this level already exists")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(position, field, value)
    await db.commit()
    await db.refresh(position)
    await load_positions_cache(db)
    return position


@router.patch("/positions/reorder", response_model=list[PositionSchema])
async def reorder_positions(
    data: PositionReorderRequest,
    owner: UserModel = Depends(get_current_owner),
    db: AsyncSession = Depends(get_async_db),
):
    """Задаёт новую иерархию должностей списком пар (id, level)."""
    ids = [item.id for item in data.positions]
    result = await db.execute(select(PositionModel).where(PositionModel.id.in_(ids)))
    positions_by_id = {p.id: p for p in result.scalars().all()}
    if len(positions_by_id) != len(ids):
        raise HTTPException(status_code=404, detail="Some positions were not found")

    levels = [item.level for item in data.positions]
    if len(set(levels)) != len(levels):
        raise HTTPException(status_code=400, detail="Levels must be unique")

    for item in data.positions:
        positions_by_id[item.id].level = item.level
    await db.commit()
    await load_positions_cache(db)

    result = await db.execute(select(PositionModel).order_by(PositionModel.level.asc()))
    return result.scalars().all()


@router.delete("/positions/{position_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_position(
    position_id: int,
    owner: UserModel = Depends(get_current_owner),
    db: AsyncSession = Depends(get_async_db),
):
    """Удаляет должность. Системные должности и должности, назначенные хотя бы одному пользователю, удалить нельзя."""
    result = await db.execute(select(PositionModel).where(PositionModel.id == position_id))
    position = result.scalar_one_or_none()
    if not position:
        raise HTTPException(status_code=404, detail="Position not found")

    if position.is_system:
        raise HTTPException(status_code=400, detail="System position cannot be deleted")

    in_use = await db.execute(select(UserModel).where(UserModel.role == position.code))
    if in_use.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Position is assigned to at least one user")

    await db.delete(position)
    await db.commit()
    await load_positions_cache(db)
    return None


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
        result = await db.execute(select(UserModel).where(UserModel.role.in_(get_production_roles())))
    elif current_user.role == ROLE_SHOP_CHIEF:
        if current_user.workshop_id is None:
            return []
        result = await db.execute(
            select(UserModel).where(
                UserModel.role.in_(get_production_roles()),
                UserModel.workshop_id == current_user.workshop_id,
            )
        )
    else:
        if current_user.section_id is None:
            return [EmployeeResponse.model_validate(current_user)]
        result = await db.execute(
            select(UserModel).where(
                UserModel.role.in_(get_production_roles()),
                or_(UserModel.section_id == current_user.section_id, UserModel.id == current_user.id),
            )
        )
    return result.scalars().all()


@router.get("/employees/{user_id}/hierarchy", response_model=EmployeeHierarchyResponse)
async def get_employee_hierarchy(
    user_id: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Возвращает начальников и подчинённых указанного сотрудника по иерархии ролей.
    Доступно, если текущий пользователь может просматривать целевого пользователя
    (владелец видит всех, остальные - в пределах своей зоны ответственности),
    либо если это собственный профиль пользователя.
    """
    result = await db.execute(select(UserModel).where(UserModel.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if current_user.id != target.id and not can_view_user(_to_scoped(current_user), _to_scoped(target)):
        raise HTTPException(status_code=403, detail="Not enough permissions to view this user's hierarchy")

    all_res = await db.execute(select(UserModel).where(UserModel.role.in_(get_production_roles())))
    all_employees = all_res.scalars().all()

    target_scoped = _to_scoped(target)
    superiors = [
        u for u in all_employees
        if u.id != target.id and can_manage_user(_to_scoped(u), target_scoped)
    ]
    subordinates = [
        u for u in all_employees
        if u.id != target.id and can_manage_user(target_scoped, _to_scoped(u))
    ]

    # Сортируем по уровню иерархии: начальники - от самого верхнего к ближайшему,
    # подчинённые - от ближайшего к самому нижнему.
    superiors.sort(key=lambda u: get_role_level(u.role))
    subordinates.sort(key=lambda u: get_role_level(u.role))

    return EmployeeHierarchyResponse(
        user=EmployeeResponse.model_validate(target),
        superiors=[EmployeeResponse.model_validate(u) for u in superiors],
        subordinates=[EmployeeResponse.model_validate(u) for u in subordinates],
    )


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


@router.post("/employees/assign", response_model=EmployeeResponse, status_code=status.HTTP_201_CREATED)
async def assign_employee(
    data: EmployeeAssign,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Назначает производственную роль уже существующему пользователю системы
    (вместо регистрации нового). Пользователь может назначить только роль
    ниже своей и только в своей зоне ответственности; если целевой
    пользователь уже состоит в иерархии, дополнительно проверяется, что
    текущий пользователь имеет право им управлять (правило 3).
    """
    if not can_assign_role(current_user.role, data.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot assign this role")

    result = await db.execute(select(UserModel).where(UserModel.id == data.user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot assign a role to yourself")

    if is_production_role(target.role) and not can_manage_user(_to_scoped(current_user), _to_scoped(target)):
        raise HTTPException(status_code=403, detail="Not enough permissions to manage this user")

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

    target.role = data.role
    target.workshop_id = resolved_workshop_id
    target.section_id = resolved_section_id
    await db.commit()
    await db.refresh(target)
    return target


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
