from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class ChatMessageBase(BaseModel):
    receiver_id: int
    message: Optional[str] = None
    file_path: Optional[str] = None
    message_type: str = "text"

class ChatMessageCreate(ChatMessageBase):
    pass

class ChatMessageResponse(ChatMessageBase):
    id: int
    sender_id: int
    timestamp: datetime
    is_read: bool

    class Config:
        from_attributes = True

class DialogResponse(BaseModel):
    user_id: int
    email: str
    avatar_url: Optional[str] = None
    last_message: str
    last_message_time: datetime
    unread_count: int
