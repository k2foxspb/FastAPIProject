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
    fcm_token: Mapped[str | None] = mapped_column(String, nullable=True)

    products: Mapped[list["Product"]] = relationship("Product", back_populates="seller")
    reviews: Mapped[list["Reviews"]] = relationship("Reviews", back_populates="user")
    cart_items: Mapped[list["CartItem"]] = relationship("CartItem", back_populates="user", cascade="all, delete-orphan")
    orders: Mapped[list["Order"]] = relationship("Order", back_populates="user", cascade="all, delete-orphan")
    photos: Mapped[list["UserPhoto"]] = relationship("UserPhoto", back_populates="user", cascade="all, delete-orphan")
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
    is_private: Mapped[bool] = mapped_column(Boolean, default=False)
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
    is_private: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship("User", back_populates="photos")
    album: Mapped["PhotoAlbum"] = relationship("PhotoAlbum", back_populates="photos")


class Friendship(Base):
    __tablename__ = "friendships"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    friend_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String, default="pending")  # "pending", "accepted"
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    sender: Mapped["User"] = relationship("User", foreign_keys=[user_id], back_populates="sent_friend_requests")
    receiver: Mapped["User"] = relationship("User", foreign_keys=[friend_id], back_populates="received_friend_requests")



