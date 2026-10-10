from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional


class AnnouncementCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)


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
