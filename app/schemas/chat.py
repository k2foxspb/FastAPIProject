from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class ChatMessageBase(BaseModel):
    receiver_id: int
    message: Optional[str] = None
    file_path: Optional[str] = None
    attachments: Optional[list[dict]] = None
    message_type: str = "text"
    client_id: Optional[str] = None # Для оптимистичных обновлений

class ChatMessageCreate(ChatMessageBase):
    pass

class ChatMessageResponse(ChatMessageBase):
    id: int
    client_id: Optional[str] = None # Возвращаем обратно
    sender_id: int
    sender_name: Optional[str] = None
    timestamp: datetime
    is_read: int

    class Config:
        from_attributes = True

class DialogResponse(BaseModel):
    user_id: int
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar_url: Optional[str] = None
    last_message: str
    last_message_time: datetime
    unread_count: int
    status: Optional[str] = "offline"
    last_seen: Optional[str] = None

class UploadInitRequest(BaseModel):
    filename: str
    file_size: int
    mime_type: Optional[str] = None

class UploadSessionResponse(BaseModel):
    upload_id: str
    offset: int
    chunk_size: int = 1024 * 1024 # 1MB по умолчанию

class UploadStatusResponse(BaseModel):
    upload_id: str
    offset: int
    is_completed: bool

class BulkDeleteMessagesRequest(BaseModel):
    message_ids: list[int]
