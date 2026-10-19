from datetime import datetime
from sqlalchemy import Integer, String, ForeignKey, DateTime, Boolean, func
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

    # Снимок зоны ответственности автора на момент публикации (для истории/аудита)
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False)  # "global", "workshop", "section"
    workshop_id: Mapped[int | None] = mapped_column(ForeignKey("workshops.id", ondelete="SET NULL"), nullable=True)
    section_id: Mapped[int | None] = mapped_column(ForeignKey("sections.id", ondelete="SET NULL"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    author: Mapped["User"] = relationship("User")
    workshop: Mapped["Workshop | None"] = relationship("Workshop")
    section: Mapped["Section | None"] = relationship("Section")
    recipients: Mapped[list["AnnouncementRecipient"]] = relationship(
        "AnnouncementRecipient", back_populates="announcement", cascade="all, delete-orphan"
    )


class AnnouncementRecipient(Base):
    """Получатель объявления (для адресной рассылки и отметок о прочтении)."""
    __tablename__ = "announcement_recipients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    announcement_id: Mapped[int] = mapped_column(ForeignKey("announcements.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    announcement: Mapped["Announcement"] = relationship("Announcement", back_populates="recipients")
    user: Mapped["User"] = relationship("User")
