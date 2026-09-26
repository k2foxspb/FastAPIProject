from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Union

class ChatMessageBase(BaseModel):
    receiver_id: Optional[int] = None
    group_id: Optional[int] = None # id группового чата (взаимоисключимо с receiver_id)
    message: Optional[str] = None
    file_path: Optional[str] = None
    attachments: Optional[list[dict]] = None
    message_type: str = "text"
    client_id: Optional[str] = None # Для оптимистичных обновлений
    duration: Optional[float] = None # Длительность аудио/видео в секундах
    reply_to_id: Optional[int] = None
    forwarded_from_id: Optional[int] = None # id исходного отправителя при пересылке
    forwarded_from_name: Optional[str] = None # имя исходного отправителя при пересылке
    comment: Optional[str] = None # комментарий, добавленный при пересылке (в том же пузыре)
    is_uploading: bool = False
    upload_id: Optional[str] = None
    upload_progress: Optional[float] = None
    upload_offset: Optional[int] = None
    upload_total: Optional[int] = None

class ChatMessageCreate(ChatMessageBase):
    pass

class MessageReactionItem(BaseModel):
    emoji: str
    user_id: int

class ChatMessageReply(BaseModel):
    id: int
    message: Optional[str] = None
    message_type: str
    sender_id: int
    sender_name: Optional[str] = None

    class Config:
        from_attributes = True

class ChatMessageResponse(ChatMessageBase):
    id: int
    client_id: Optional[str] = None # Возвращаем обратно
    sender_id: int
    sender_name: Optional[str] = None
    timestamp: datetime
    is_read: int
    reply_to: Optional[ChatMessageReply] = None
    forwarded_from_id: Optional[int] = None
    forwarded_from_name: Optional[str] = None
    comment: Optional[str] = None
    reactions: Optional[list[MessageReactionItem]] = None
    is_uploading: bool = False
    upload_id: Optional[str] = None
    upload_progress: Optional[float] = None
    upload_offset: Optional[int] = None
    upload_total: Optional[int] = None
    deleted_by_sender: bool = False
    deleted_by_receiver: bool = False
    group_id: Optional[int] = None

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
    receiver_id: Optional[Union[str, int]] = None
    client_id: Optional[str] = None
    message_type: Optional[str] = None
    duration: Optional[float] = None
    reply_to_id: Optional[int] = None

    class Config:
        extra = "ignore"

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

# --- Групповые чаты ---

class GroupChatCreate(BaseModel):
    name: str
    member_ids: list[int] = []
    avatar_url: Optional[str] = None

class GroupChatUpdate(BaseModel):
    name: Optional[str] = None
    avatar_url: Optional[str] = None

class AddGroupMembersRequest(BaseModel):
    user_ids: list[int]

class GroupChatMemberResponse(BaseModel):
    user_id: int
    role: str # "owner", "admin", "member"
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True

class GroupChatResponse(BaseModel):
    id: int
    name: str
    avatar_url: Optional[str] = None
    owner_id: int
    my_role: Optional[str] = None
    members_count: int = 0
    last_message: Optional[str] = None
    last_message_time: Optional[datetime] = None
    unread_count: int = 0

    class Config:
        from_attributes = True

class GroupChatDetailResponse(BaseModel):
    id: int
    name: str
    avatar_url: Optional[str] = None
    owner_id: int
    my_role: Optional[str] = None
    members: list[GroupChatMemberResponse] = []

    class Config:
        from_attributes = True
