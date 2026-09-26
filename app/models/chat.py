from sqlalchemy import Integer, String, ForeignKey, DateTime, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime

from app.database import Base

class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sender_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # Для личных сообщений заполнен receiver_id, для групповых - group_id (одно из двух)
    receiver_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    group_id: Mapped[int] = mapped_column(Integer, ForeignKey("group_chats.id", ondelete="CASCADE"), nullable=True)
    message: Mapped[str] = mapped_column(String, nullable=True)
    file_path: Mapped[str] = mapped_column(String, nullable=True)
    message_type: Mapped[str] = mapped_column(String, default="text") # text, image, file
    client_id: Mapped[str] = mapped_column(String, nullable=True) # Для оптимистичных обновлений
    duration: Mapped[float] = mapped_column(Integer, nullable=True) # Длительность аудио/видео в секундах
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_read: Mapped[int] = mapped_column(Integer, default=0)
    reply_to_id: Mapped[int] = mapped_column(Integer, ForeignKey("chat_messages.id"), nullable=True)
    deleted_by_sender: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_by_receiver: Mapped[bool] = mapped_column(Boolean, default=False)
    is_uploading: Mapped[bool] = mapped_column(Boolean, default=False)
    upload_id: Mapped[str] = mapped_column(String, nullable=True)
    # Пересылка: id и имя исходного отправителя сообщения (для отметки "Переслано от" и ссылки на профиль)
    forwarded_from_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    forwarded_from_name: Mapped[str] = mapped_column(String, nullable=True)
    # Комментарий, добавленный при пересылке (отображается в том же пузыре, что и пересланное сообщение)
    comment: Mapped[str] = mapped_column(String, nullable=True)

    sender = relationship("User", foreign_keys=[sender_id])
    receiver = relationship("User", foreign_keys=[receiver_id])
    reply_to = relationship("ChatMessage", remote_side=[id])
    forwarded_from = relationship("User", foreign_keys=[forwarded_from_id])
    group = relationship("GroupChat", foreign_keys=[group_id])

class GroupChat(Base):
    __tablename__ = "group_chats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    avatar_url: Mapped[str] = mapped_column(String, nullable=True)
    owner_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    owner = relationship("User", foreign_keys=[owner_id])
    members = relationship("GroupChatMember", back_populates="group", cascade="all, delete-orphan")

class GroupChatMember(Base):
    __tablename__ = "group_chat_members"
    __table_args__ = (
        UniqueConstraint("group_id", "user_id", name="uq_group_chat_member_group_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(Integer, ForeignKey("group_chats.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # Роль участника в группе: "owner", "admin", "member"
    role: Mapped[str] = mapped_column(String, default="member")
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    group = relationship("GroupChat", back_populates="members")
    user = relationship("User", foreign_keys=[user_id])

class ChatMessageReaction(Base):
    __tablename__ = "chat_message_reactions"
    __table_args__ = (
        # У пользователя может быть только одна реакция на сообщение
        # (повторный тап тем же смайликом снимает её, другим — заменяет)
        UniqueConstraint("message_id", "user_id", name="uq_chat_message_reaction_message_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[int] = mapped_column(Integer, ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    emoji: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    message = relationship("ChatMessage", foreign_keys=[message_id])
    user = relationship("User", foreign_keys=[user_id])

class FileUploadSession(Base):
    __tablename__ = "file_upload_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True) # UUID
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String, nullable=True)
    offset: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False)
