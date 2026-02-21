from datetime import datetime
from sqlalchemy import String, ForeignKey, DateTime, func, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from typing import TYPE_CHECKING
from app.database import Base

if TYPE_CHECKING:
    from app.models.users import User

class News(Base):
    __tablename__ = "news"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(String, nullable=False)
    image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    moderation_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False) # "pending", "approved", "rejected"
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    author: Mapped["User"] = relationship("User")
    images: Mapped[list["NewsImage"]] = relationship("NewsImage", back_populates="news", cascade="all, delete-orphan")
    reactions: Mapped[list["NewsReaction"]] = relationship("NewsReaction", back_populates="news", cascade="all, delete-orphan")

class NewsImage(Base):
    __tablename__ = "news_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    news_id: Mapped[int] = mapped_column(ForeignKey("news.id", ondelete="CASCADE"), nullable=False)
    image_url: Mapped[str] = mapped_column(String, nullable=False)
    thumbnail_url: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    news: Mapped["News"] = relationship("News", back_populates="images")

class NewsReaction(Base):
    __tablename__ = "news_reactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    news_id: Mapped[int] = mapped_column(ForeignKey("news.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reaction_type: Mapped[int] = mapped_column(Integer, nullable=False) # 1 for like, -1 for dislike

    news: Mapped["News"] = relationship("News", back_populates="reactions")
    user: Mapped["User"] = relationship("User")
