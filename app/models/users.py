from datetime import datetime
from sqlalchemy import Boolean, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models import Product, Reviews, CartItem
from app.models.orders import Order

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    role: Mapped[str] = mapped_column(String, default="buyer")  # "buyer" or "seller"
    status: Mapped[str] = mapped_column(String, default="offline", nullable=True)
    last_seen: Mapped[str] = mapped_column(String, nullable=True)

    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_preview_url: Mapped[str | None] = mapped_column(String, nullable=True)

    products: Mapped[list["Product"]] = relationship("Product", back_populates="seller")
    reviews: Mapped[list["Reviews"]] = relationship("Reviews", back_populates="user")
    cart_items: Mapped[list["CartItem"]] = relationship("CartItem", back_populates="user", cascade="all, delete-orphan")
    orders: Mapped[list["Order"]] = relationship("Order", back_populates="user", cascade="all, delete-orphan")
    photos: Mapped[list["UserPhoto"]] = relationship("UserPhoto", back_populates="user", cascade="all, delete-orphan")
    albums: Mapped[list["PhotoAlbum"]] = relationship("PhotoAlbum", back_populates="user", cascade="all, delete-orphan")


class PhotoAlbum(Base):
    __tablename__ = "photo_albums"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship("User", back_populates="photos")
    album: Mapped["PhotoAlbum"] = relationship("PhotoAlbum", back_populates="photos")



