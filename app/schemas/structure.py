from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional


class WorkshopBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None


class WorkshopCreate(WorkshopBase):
    pass


class WorkshopUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class Workshop(WorkshopBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SectionBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None


class SectionCreate(SectionBase):
    workshop_id: int


class SectionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class Section(SectionBase):
    id: int
    workshop_id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class EmployeeCreate(BaseModel):
    """Создание сотрудника производственной иерархии."""
    email: Optional[str] = None
    phone_number: Optional[str] = None
    password: str = Field(min_length=8, description="Пароль (минимум 8 символов)")
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: str = Field(description="Код должности (см. GET /org/positions)")
    workshop_id: Optional[int] = None
    section_id: Optional[int] = None


class EmployeeAssign(BaseModel):
    """Назначение производственной роли уже существующему пользователю системы."""
    user_id: int
    role: str = Field(description="Код должности (см. GET /org/positions)")
    workshop_id: Optional[int] = None
    section_id: Optional[int] = None


class EmployeeRoleUpdate(BaseModel):
    role: str = Field(description="Код должности (см. GET /org/positions)")


class EmployeeAssignmentUpdate(BaseModel):
    workshop_id: Optional[int] = None
    section_id: Optional[int] = None


class MoveWorkerRequest(BaseModel):
    section_id: int = Field(description="ID участка, на который нужно перевести рабочего")


class EmployeeResponse(BaseModel):
    id: int
    email: Optional[str] = None
    phone_number: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: str
    is_active: bool
    workshop_id: Optional[int] = None
    section_id: Optional[int] = None
    avatar_url: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class EmployeeHierarchyResponse(BaseModel):
    """Руководители и подчинённые конкретного сотрудника по иерархии ролей."""
    user: EmployeeResponse
    superiors: list[EmployeeResponse] = Field(default_factory=list)
    subordinates: list[EmployeeResponse] = Field(default_factory=list)


class PositionBase(BaseModel):
    name: str = Field(min_length=1, max_length=200, description="Отображаемое название должности")
    scope: str = Field(
        default="section",
        description="Область ответственности: 'global', 'workshop', 'section' или 'self'",
    )
    icon: str = Field(
        default="person",
        max_length=50,
        description="Имя иконки (Ionicons), отображаемой у должности и в профиле сотрудника",
    )


class PositionCreate(PositionBase):
    level: int = Field(
        description="Уровень в иерархии (чем меньше - тем выше должность). "
                    "На одном уровне может находиться любое количество должностей.",
    )


class PositionUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    scope: Optional[str] = None
    level: Optional[int] = None
    icon: Optional[str] = Field(default=None, max_length=50)


class PositionReorderItem(BaseModel):
    id: int
    level: int


class PositionReorderRequest(BaseModel):
    positions: list[PositionReorderItem]


class Position(PositionBase):
    id: int
    code: str
    level: int
    is_system: bool
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
