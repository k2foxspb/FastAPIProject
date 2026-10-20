from datetime import datetime
from sqlalchemy import Boolean, Integer, String, ForeignKey, DateTime, Numeric, JSON, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from typing import TYPE_CHECKING
from app.database import Base

if TYPE_CHECKING:
    from app.models.structure import Workshop, Section

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str | None] = mapped_column(String, unique=True, index=True, nullable=True)
    phone_number: Mapped[str | None] = mapped_column(String, unique=True, index=True, nullable=True)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    first_name: Mapped[str | None] = mapped_column(String, nullable=True)
    last_name: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    role: Mapped[str] = mapped_column(String, default="worker")
    # Роли: "admin", "owner" и производственная иерархия
    # ("owner", "shop_chief", "section_chief", "master",
    # "assistant_master", "worker" — см. app.core.roles).
    status: Mapped[str] = mapped_column(String, default="offline", nullable=True)
    last_seen: Mapped[str] = mapped_column(String, nullable=True)

    # Табельный номер сотрудника (указывается при регистрации/оформлении).
    tab_number: Mapped[str | None] = mapped_column(String, nullable=True)
    # График работы - сколько часов в день обычно работает сотрудник
    # (например 8 или 7.2 при сокращённом дне).
    work_schedule_hours: Mapped[float | None] = mapped_column(Numeric(4, 2), nullable=True, default=8)

    # Привязка к производственной структуре (цех/участок)
    workshop_id: Mapped[int | None] = mapped_column(ForeignKey("workshops.id", ondelete="SET NULL"), nullable=True)
    section_id: Mapped[int | None] = mapped_column(ForeignKey("sections.id", ondelete="SET NULL"), nullable=True)

    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_preview_url: Mapped[str | None] = mapped_column(String, nullable=True)
    verification_code: Mapped[str | None] = mapped_column(String, nullable=True)
    fcm_token: Mapped[str | None] = mapped_column(String, nullable=True)

    # Настройки уведомлений пользователя: отключённые группы оповещений и
    # "тихие часы" (ночное время, когда уведомления приходят без звука).
    # Формат: {"disabled_groups": ["announcements", ...],
    #          "quiet_hours_enabled": bool,
    #          "quiet_hours_start": "HH:MM", "quiet_hours_end": "HH:MM"}
    # См. app.core.notifications - единая точка применения этих настроек.
    notification_settings: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    posts: Mapped[list["ProfilePost"]] = relationship("ProfilePost", back_populates="user", cascade="all, delete-orphan")
    photos: Mapped[list["UserPhoto"]] = relationship("UserPhoto", back_populates="user", cascade="all, delete-orphan")
    photo_comments: Mapped[list["UserPhotoComment"]] = relationship("UserPhotoComment", back_populates="user", cascade="all, delete-orphan")
    photo_reactions: Mapped[list["UserPhotoReaction"]] = relationship("UserPhotoReaction", back_populates="user", cascade="all, delete-orphan")
    albums: Mapped[list["PhotoAlbum"]] = relationship("PhotoAlbum", back_populates="user", cascade="all, delete-orphan")
    album_comments: Mapped[list["PhotoAlbumComment"]] = relationship("PhotoAlbumComment", back_populates="user", cascade="all, delete-orphan")
    album_reactions: Mapped[list["PhotoAlbumReaction"]] = relationship("PhotoAlbumReaction", back_populates="user", cascade="all, delete-orphan")
    admin_permissions: Mapped[list["AdminPermission"]] = relationship("AdminPermission", back_populates="admin", cascade="all, delete-orphan")
    workshop: Mapped["Workshop | None"] = relationship("Workshop", back_populates="employees", foreign_keys=[workshop_id])
    section: Mapped["Section | None"] = relationship("Section", back_populates="employees", foreign_keys=[section_id])

    # Friends relationships
    sent_friend_requests: Mapped[list["Friendship"]] = relationship(
        "Friendship",
        foreign_keys="[Friendship.user_id]",
        back_populates="sender",
        cascade="all, delete-orphan"
    )
    received_friend_requests: Mapped[list["Friendship"]] = relationship(
        "Friendship",
        foreign_keys="[Friendship.friend_id]",
        back_populates="receiver",
        cascade="all, delete-orphan"
    )


class AdminPermission(Base):
    __tablename__ = "admin_permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    admin_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    model_name: Mapped[str] = mapped_column(String, nullable=False)  # Название модели, к которой разрешен доступ

    admin: Mapped["User"] = relationship("User", back_populates="admin_permissions")


class PhotoAlbum(Base):
    __tablename__ = "photo_albums"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    privacy: Mapped[str] = mapped_column(String, default="public")  # "public", "friends", "private"
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship("User", back_populates="albums")
    photos: Mapped[list["UserPhoto"]] = relationship("UserPhoto", back_populates="album", cascade="all, delete-orphan")
    comments: Mapped[list["PhotoAlbumComment"]] = relationship("PhotoAlbumComment", back_populates="album", cascade="all, delete-orphan")
    reactions: Mapped[list["PhotoAlbumReaction"]] = relationship("PhotoAlbumReaction", back_populates="album", cascade="all, delete-orphan")


class UserPhoto(Base):
    __tablename__ = "user_photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    album_id: Mapped[int | None] = mapped_column(ForeignKey("photo_albums.id", ondelete="CASCADE"), nullable=True)
    image_url: Mapped[str] = mapped_column(String, nullable=False)
    preview_url: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    privacy: Mapped[str] = mapped_column(String, default="public")  # "public", "friends", "private"
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship("User", back_populates="photos")
    album: Mapped["PhotoAlbum"] = relationship("PhotoAlbum", back_populates="photos")
    comments: Mapped[list["UserPhotoComment"]] = relationship("UserPhotoComment", back_populates="photo", cascade="all, delete-orphan")
    reactions: Mapped[list["UserPhotoReaction"]] = relationship("UserPhotoReaction", back_populates="photo", cascade="all, delete-orphan")


class Friendship(Base):
    __tablename__ = "friendships"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    friend_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String, default="pending")  # "pending", "accepted"
    deleted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    sender: Mapped["User"] = relationship("User", foreign_keys=[user_id], back_populates="sent_friend_requests")
    receiver: Mapped["User"] = relationship("User", foreign_keys=[friend_id], back_populates="received_friend_requests")
    deleted_by_user: Mapped["User | None"] = relationship("User", foreign_keys=[deleted_by_id])


class UserPhotoComment(Base):
    __tablename__ = "user_photo_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    photo_id: Mapped[int] = mapped_column(ForeignKey("user_photos.id", ondelete="CASCADE"), nullable=False)
    comment: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship("User", back_populates="photo_comments")
    photo: Mapped["UserPhoto"] = relationship("UserPhoto", back_populates="comments")
    reactions: Mapped[list["UserPhotoCommentReaction"]] = relationship("UserPhotoCommentReaction", back_populates="comment", cascade="all, delete-orphan")


class UserPhotoCommentReaction(Base):
    __tablename__ = "user_photo_comment_reactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    comment_id: Mapped[int] = mapped_column(ForeignKey("user_photo_comments.id", ondelete="CASCADE"), nullable=False)
    reaction_type: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 for like, -1 for dislike

    user: Mapped["User"] = relationship("User")
    comment: Mapped["UserPhotoComment"] = relationship("UserPhotoComment", back_populates="reactions")


class UserPhotoReaction(Base):
    __tablename__ = "user_photo_reactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    photo_id: Mapped[int] = mapped_column(ForeignKey("user_photos.id", ondelete="CASCADE"), nullable=False)
    reaction_type: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 for like, -1 for dislike

    user: Mapped["User"] = relationship("User", back_populates="photo_reactions")
    photo: Mapped["UserPhoto"] = relationship("UserPhoto", back_populates="reactions")


class AppVersion(Base):
    __tablename__ = "app_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class PhotoAlbumComment(Base):
    __tablename__ = "photo_album_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    album_id: Mapped[int] = mapped_column(ForeignKey("photo_albums.id", ondelete="CASCADE"), nullable=False)
    comment: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship("User", back_populates="album_comments")
    album: Mapped["PhotoAlbum"] = relationship("PhotoAlbum", back_populates="comments")
    reactions: Mapped[list["PhotoAlbumCommentReaction"]] = relationship("PhotoAlbumCommentReaction", back_populates="comment", cascade="all, delete-orphan")

class PhotoAlbumReaction(Base):
    __tablename__ = "photo_album_reactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    album_id: Mapped[int] = mapped_column(ForeignKey("photo_albums.id", ondelete="CASCADE"), nullable=False)
    reaction_type: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 for like, -1 for dislike

    user: Mapped["User"] = relationship("User", back_populates="album_reactions")
    album: Mapped["PhotoAlbum"] = relationship("PhotoAlbum", back_populates="reactions")

class PhotoAlbumCommentReaction(Base):
    __tablename__ = "photo_album_comment_reactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    comment_id: Mapped[int] = mapped_column(ForeignKey("photo_album_comments.id", ondelete="CASCADE"), nullable=False)
    reaction_type: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 for like, -1 for dislike

    user: Mapped["User"] = relationship("User")
    comment: Mapped["PhotoAlbumComment"] = relationship("PhotoAlbumComment", back_populates="reactions")


class ProfilePost(Base):
    """Личные публикации в профиле пользователя (без модерации, не попадают в новости/объявления)."""
    __tablename__ = "profile_posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content: Mapped[str | None] = mapped_column(String, nullable=True)
    media_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    media_type: Mapped[str | None] = mapped_column(String(50), nullable=True)  # "image", "video", etc.
    privacy: Mapped[str] = mapped_column(String(20), default="public", server_default="public", nullable=False)  # "public", "friends", "private"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="posts")
    comments: Mapped[list["ProfilePostComment"]] = relationship(
        "ProfilePostComment", back_populates="post", cascade="all, delete-orphan", order_by="ProfilePostComment.created_at.asc()"
    )
    reactions: Mapped[list["ProfilePostReaction"]] = relationship(
        "ProfilePostReaction", back_populates="post", cascade="all, delete-orphan"
    )


class ProfilePostComment(Base):
    """Комментарии к публикации в профиле."""
    __tablename__ = "profile_post_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("profile_posts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    comment: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    post: Mapped["ProfilePost"] = relationship("ProfilePost", back_populates="comments")
    user: Mapped["User"] = relationship("User")


class ProfilePostReaction(Base):
    """Реакции на публикацию в профиле (уникальность: post_id + user_id)."""
    __tablename__ = "profile_post_reactions"
    __table_args__ = (
        UniqueConstraint("post_id", "user_id", name="uq_profile_post_reactions_post_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("profile_posts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    reaction_type: Mapped[str] = mapped_column(String(50), nullable=False)  # "like", "heart", "1", etc.

    post: Mapped["ProfilePost"] = relationship("ProfilePost", back_populates="reactions")
    user: Mapped["User"] = relationship("User")



