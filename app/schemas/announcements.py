from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional


class AnnouncementCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)
    # Необязательное сужение зоны рассылки в пределах собственной зоны
    # ответственности автора (например, начальник цеха может разослать
    # объявление только одному участку, а не всему цеху).
    target_workshop_id: Optional[int] = Field(
        default=None, description="Разослать только по этому цеху (должен быть в зоне ответственности автора)"
    )
    target_section_id: Optional[int] = Field(
        default=None, description="Разослать только по этому участку (должен быть в зоне ответственности автора)"
    )


class AnnouncementAuthor(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: str
    avatar_url: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class Announcement(BaseModel):
    id: int
    title: str
    content: str
    scope_type: str
    workshop_id: Optional[int] = None
    section_id: Optional[int] = None
    created_at: datetime
    author: Optional[AnnouncementAuthor] = None
    recipients_count: int = 0
    is_read: Optional[bool] = None
    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def model_validate(cls, obj, **kwargs):
        item = super().model_validate(obj, **kwargs)
        workshop = getattr(obj, "workshop", None)
        if workshop is not None:
            item.workshop_name = workshop.name
        section = getattr(obj, "section", None)
        if section is not None:
            item.section_name = section.name
        return item

    workshop_name: Optional[str] = None
    section_name: Optional[str] = None
