from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional

from app.core.roles import PRODUCTION_ROLES


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
    role: str = Field(description=f"Одна из ролей: {', '.join(PRODUCTION_ROLES)}")
    workshop_id: Optional[int] = None
    section_id: Optional[int] = None


class EmployeeRoleUpdate(BaseModel):
    role: str = Field(description=f"Одна из ролей: {', '.join(PRODUCTION_ROLES)}")


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
    model_config = ConfigDict(from_attributes=True)
