from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, ConfigDict, field_validator
from typing import Any


class UserCreate(BaseModel):
    email: EmailStr = Field(description="Email пользователя")
    password: str = Field(min_length=8, description="Пароль (минимум 8 символов)")
    role: str = Field(default="buyer", pattern="^(buyer|seller|admin)$",
                      description="Роль: 'buyer' или 'seller' или администратор")


class UserPhotoBase(BaseModel):
    image_url: str
    preview_url: str
    description: str | None = None
    album_id: int | None = None

class UserPhotoCreate(UserPhotoBase):
    pass

class UserPhoto(UserPhotoBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PhotoAlbumBase(BaseModel):
    title: str
    description: str | None = None

class PhotoAlbumCreate(PhotoAlbumBase):
    pass

class PhotoAlbum(PhotoAlbumBase):
    id: int
    user_id: int
    created_at: datetime
    photos: list[UserPhoto] = Field(default_factory=list)
    
    # Для превью альбома (последняя фотография)
    album_preview_url: str | None = None
    
    model_config = ConfigDict(from_attributes=True)

    @field_validator('photos', mode='before')
    @classmethod
    def prevent_lazy_loading(cls, v: Any) -> Any:
        try:
            if v is None:
                return []
            iter(v)
            return v
        except Exception:
            return []

    @classmethod
    def model_validate(cls, obj, **kwargs):
        # Переопределяем для того чтобы вычислить album_preview_url
        data = super().model_validate(obj, **kwargs)
        try:
            # Check if photos are loaded before accessing them
            if hasattr(obj, 'photos'):
                iter(obj.photos)
                if obj.photos:
                    # Сортируем по дате создания или по ID (последняя добавленная)
                    sorted_photos = sorted(obj.photos, key=lambda x: x.created_at or x.id, reverse=True)
                    data.album_preview_url = sorted_photos[0].preview_url
        except Exception:
            # If not loaded, album_preview_url remains None
            pass
        return data


class User(BaseModel):
    id: int
    email: EmailStr
    is_active: bool
    role: str
    status: str | None = "offline"
    avatar_url: str | None = None
    avatar_preview_url: str | None = None
    photos: list[UserPhoto] = Field(default_factory=list)
    albums: list[PhotoAlbum] = Field(default_factory=list)
    
    model_config = ConfigDict(from_attributes=True)

    @field_validator('photos', 'albums', mode='before')
    @classmethod
    def prevent_lazy_loading(cls, v: Any) -> Any:
        try:
            # Try to access the value to see if it's loaded
            # For SQLAlchemy async, accessing an unloaded relationship
            # outside of a greenlet will raise an error.
            if v is None:
                return []
            # We just need to check if it's iterable without error
            iter(v)
            return v
        except Exception:
            # If any error occurs (like MissingGreenlet), return empty list
            return []


class RefreshTokenRequest(BaseModel):
    refresh_token: str




