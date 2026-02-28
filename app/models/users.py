from datetime import datetime
from sqlalchemy import Boolean, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from typing import TYPE_CHECKING
from app.database import Base

if TYPE_CHECKING:
    from app.models.products import Product
    from app.models.reviews import Reviews
    from app.models.cart_items import CartItem
    from app.models.orders import Order

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    first_name: Mapped[str | None] = mapped_column(String, nullable=True)
    last_name: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    role: Mapped[str] = mapped_column(String, default="buyer")  # "buyer", "seller", "admin", "owner"
    status: Mapped[str] = mapped_column(String, default="offline", nullable=True)
    last_seen: Mapped[str] = mapped_column(String, nullable=True)

    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_preview_url: Mapped[str | None] = mapped_column(String, nullable=True)
    verification_code: Mapped[str | None] = mapped_column(String, nullable=True)
    fcm_token: Mapped[str | None] = mapped_column(String, nullable=True)

    products: Mapped[list["Product"]] = relationship("Product", back_populates="seller")
    reviews: Mapped[list["Reviews"]] = relationship("Reviews", back_populates="user")
    cart_items: Mapped[list["CartItem"]] = relationship("CartItem", back_populates="user", cascade="all, delete-orphan")
    orders: Mapped[list["Order"]] = relationship("Order", back_populates="user", cascade="all, delete-orphan")
    photos: Mapped[list["UserPhoto"]] = relationship("UserPhoto", back_populates="user", cascade="all, delete-orphan")
    photo_comments: Mapped[list["UserPhotoComment"]] = relationship("UserPhotoComment", back_populates="user", cascade="all, delete-orphan")
    photo_reactions: Mapped[list["UserPhotoReaction"]] = relationship("UserPhotoReaction", back_populates="user", cascade="all, delete-orphan")
    albums: Mapped[list["PhotoAlbum"]] = relationship("PhotoAlbum", back_populates="user", cascade="all, delete-orphan")
    admin_permissions: Mapped[list["AdminPermission"]] = relationship("AdminPermission", back_populates="admin", cascade="all, delete-orphan")

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
    admin_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    model_name: Mapped[str] = mapped_column(String, nullable=False)  # Название модели, к которой разрешен доступ

    admin: Mapped["User"] = relationship("User", back_populates="admin_permissions")


class PhotoAlbum(Base):
    __tablename__ = "photo_albums"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    privacy: Mapped[str] = mapped_column(String, default="public")  # "public", "friends", "private"
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship("User", back_populates="albums")
    photos: Mapped[list["UserPhoto"]] = relationship("UserPhoto", back_populates="album", cascade="all, delete-orphan")


class UserPhoto(Base):
    __tablename__ = "user_photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    album_id: Mapped[int | None] = mapped_column(ForeignKey("photo_albums.id"), nullable=True)
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
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    friend_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String, default="pending")  # "pending", "accepted"
    deleted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    sender: Mapped["User"] = relationship("User", foreign_keys=[user_id], back_populates="sent_friend_requests")
    receiver: Mapped["User"] = relationship("User", foreign_keys=[friend_id], back_populates="received_friend_requests")
    deleted_by_user: Mapped["User | None"] = relationship("User", foreign_keys=[deleted_by_id])


class UserPhotoComment(Base):
    __tablename__ = "user_photo_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    photo_id: Mapped[int] = mapped_column(ForeignKey("user_photos.id"), nullable=False)
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



