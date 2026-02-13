from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, ConfigDict


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
    photos: list[UserPhoto] = []
    
    # Для превью альбома (последняя фотография)
    album_preview_url: str | None = None
    
    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def model_validate(cls, obj, **kwargs):
        # Переопределяем для того чтобы вычислить album_preview_url
        data = super().model_validate(obj, **kwargs)
        if hasattr(obj, 'photos') and obj.photos:
            # Сортируем по дате создания или по ID (последняя добавленная)
            sorted_photos = sorted(obj.photos, key=lambda x: x.created_at or x.id, reverse=True)
            data.album_preview_url = sorted_photos[0].preview_url
        return data


class User(BaseModel):
    id: int
    email: EmailStr
    is_active: bool
    role: str
    status: str
    avatar_url: str | None = None
    avatar_preview_url: str | None = None
    photos: list[UserPhoto] = []
    albums: list[PhotoAlbum] = []
    model_config = ConfigDict(from_attributes=True)


class RefreshTokenRequest(BaseModel):
    refresh_token: str




