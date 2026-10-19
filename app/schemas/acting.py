from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional


class ActingAssignmentCreate(BaseModel):
    """
    Назначение исполняющего обязанности (и.о.) на должность другого
    сотрудника. Замещается именно должность (acting_role) - её снимок
    фиксируется на момент создания назначения.
    """
    user_id: int = Field(description="Кто будет исполнять обязанности (и.о.)")
    acting_role: str = Field(description="Код замещаемой должности (см. GET /org/positions)")
    replaced_user_id: Optional[int] = Field(
        default=None, description="Кого замещают - опционально, для истории/уведомлений"
    )
    acting_workshop_id: Optional[int] = Field(
        default=None, description="Зона ответственности замещаемой должности (цех). Если не указана - берётся у replaced_user_id"
    )
    acting_section_id: Optional[int] = Field(
        default=None, description="Зона ответственности замещаемой должности (участок). Если не указана - берётся у replaced_user_id"
    )
    starts_at: Optional[datetime] = Field(default=None, description="Начало действия назначения (по умолчанию - сейчас)")
    ends_at: Optional[datetime] = Field(default=None, description="Окончание действия назначения (опционально)")


class ActingAssignmentResponse(BaseModel):
    id: int
    user_id: int
    replaced_user_id: Optional[int] = None
    acting_role: str
    acting_workshop_id: Optional[int] = None
    acting_section_id: Optional[int] = None
    assigned_by_id: int
    starts_at: datetime
    ends_at: Optional[datetime] = None
    is_active: bool
    revoked_at: Optional[datetime] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
