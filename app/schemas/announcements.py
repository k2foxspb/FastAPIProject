from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List


class AnnouncementCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)
    priority: str = Field(default="normal", description="normal / important / urgent")
    target_type: Optional[str] = None
    target_workshop_id: Optional[int] = Field(
        default=None, description="Разослать только по этому цеху (должен быть в зоне ответственности автора)"
    )
    target_section_id: Optional[int] = Field(
        default=None, description="Разослать только по этому участку (должен быть в зоне ответственности автора)"
    )
    target_role: Optional[str] = Field(
        default=None, description="Разослать только определенной роли"
    )
    workshop_id: Optional[int] = None
    section_id: Optional[int] = None
    expires_at: Optional[datetime] = None


class AnnouncementAuthor(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: str
    avatar_url: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class AnnouncementRecipientUser(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    workshop_id: Optional[int] = None
    section_id: Optional[int] = None
    avatar_url: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class AnnouncementRecipientAudit(BaseModel):
    id: int
    user_id: int
    user: Optional[AnnouncementRecipientUser] = None
    is_read: bool
    read_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class Announcement(BaseModel):
    id: int
    author_id: Optional[int] = None
    title: str
    content: str
    priority: str = "normal"
    target_type: Optional[str] = None
    target_workshop_id: Optional[int] = None
    target_section_id: Optional[int] = None
    target_role: Optional[str] = None
    scope_type: Optional[str] = None
    workshop_id: Optional[int] = None
    section_id: Optional[int] = None
    created_at: datetime
    expires_at: Optional[datetime] = None
    is_active: bool = True
    author: Optional[AnnouncementAuthor] = None
    recipients_count: int = 0
    is_read: Optional[bool] = None
    read_at: Optional[datetime] = None
    workshop_name: Optional[str] = None
    section_name: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def model_validate(cls, obj, **kwargs):
        item = super().model_validate(obj, **kwargs)
        workshop = getattr(obj, "workshop", None)
        if workshop is not None:
            item.workshop_name = getattr(workshop, "name", None)
        section = getattr(obj, "section", None)
        if section is not None:
            item.section_name = getattr(section, "name", None)
        return item
