from datetime import datetime
from sqlalchemy import Integer, String, ForeignKey, DateTime, Boolean, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from typing import TYPE_CHECKING
from app.database import Base

if TYPE_CHECKING:
    from app.models.users import User
    from app.models.structure import Workshop, Section


class Announcement(Base):
    """Объявление, рассылаемое вниз по иерархии ролей."""
    __tablename__ = "announcements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(String, nullable=False)
    priority: Mapped[str] = mapped_column(String(20), default="normal", server_default="normal", nullable=False)  # normal / important / urgent
    target_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    target_workshop_id: Mapped[int | None] = mapped_column(ForeignKey("workshops.id", ondelete="SET NULL"), nullable=True)
    target_section_id: Mapped[int | None] = mapped_column(ForeignKey("sections.id", ondelete="SET NULL"), nullable=True)
    target_role: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Зона ответственности автора на момент публикации (для обратной совместимости)
    scope_type: Mapped[str | None] = mapped_column(String(20), nullable=True, default="global", server_default="global")
    workshop_id: Mapped[int | None] = mapped_column(ForeignKey("workshops.id", ondelete="SET NULL"), nullable=True)
    section_id: Mapped[int | None] = mapped_column(ForeignKey("sections.id", ondelete="SET NULL"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", nullable=False)

    author: Mapped["User"] = relationship("User")
    workshop: Mapped["Workshop | None"] = relationship("Workshop", foreign_keys=[workshop_id])
    section: Mapped["Section | None"] = relationship("Section", foreign_keys=[section_id])
    target_workshop: Mapped["Workshop | None"] = relationship("Workshop", foreign_keys=[target_workshop_id])
    target_section: Mapped["Section | None"] = relationship("Section", foreign_keys=[target_section_id])
    recipients: Mapped[list["AnnouncementRecipient"]] = relationship(
        "AnnouncementRecipient", back_populates="announcement", cascade="all, delete-orphan"
    )
    comments: Mapped[list["AnnouncementComment"]] = relationship(
        "AnnouncementComment", back_populates="announcement", cascade="all, delete-orphan"
    )


class AnnouncementRecipient(Base):
    """Получатель объявления (для адресной рассылки и отметок о прочтении)."""
    __tablename__ = "announcement_recipients"
    __table_args__ = (
        UniqueConstraint("announcement_id", "user_id", name="uq_announcement_recipients_announcement_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    announcement_id: Mapped[int] = mapped_column(ForeignKey("announcements.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    announcement: Mapped["Announcement"] = relationship("Announcement", back_populates="recipients")
    user: Mapped["User"] = relationship("User")


class AnnouncementComment(Base):
    """Комментарий к объявлению."""
    __tablename__ = "announcement_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    announcement_id: Mapped[int] = mapped_column(ForeignKey("announcements.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    comment: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    announcement: Mapped["Announcement"] = relationship("Announcement", back_populates="comments")
    user: Mapped["User"] = relationship("User")
