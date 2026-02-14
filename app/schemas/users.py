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

class UserPhotoUpdate(BaseModel):
    description: str | None = None
    album_id: int | None = None

class UserPhoto(UserPhotoBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PhotoAlbumBase(BaseModel):
    title: str
    description: str | None = None

class PhotoAlbumCreate(PhotoAlbumBase):
    pass

class PhotoAlbumUpdate(BaseModel):
    title: str | None = None
    description: str | None = None

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
        # We need to be careful here. If we call super().model_validate(obj),
        # Pydantic will try to access all fields, including 'photos'.
        # To prevent MissingGreenlet, we can manually create the data dict.
        
        from sqlalchemy import inspect
        insp = inspect(obj)
        
        # Get base fields
        data = {
            "id": obj.id,
            "user_id": obj.user_id,
            "title": obj.title,
            "description": obj.description,
            "created_at": obj.created_at,
            "photos": []
        }
        
        if 'photos' not in insp.unloaded:
            data["photos"] = [UserPhoto.model_validate(p) for p in obj.photos]
            if obj.photos:
                sorted_photos = sorted(obj.photos, key=lambda x: x.created_at or x.id, reverse=True)
                data["album_preview_url"] = sorted_photos[0].preview_url
        
        return cls.model_construct(**data)


class User(BaseModel):
    id: int
    email: EmailStr
    is_active: bool
    role: str
    status: str | None = "offline"
    avatar_url: str | None = None
    avatar_preview_url: str | None = None
    photos: list[UserPhoto] = []
    albums: list[PhotoAlbum] = []
    
    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def model_validate(cls, obj, **kwargs):
        from sqlalchemy import inspect
        insp = inspect(obj)
        
        data = {
            "id": obj.id,
            "email": obj.email,
            "is_active": obj.is_active,
            "role": obj.role,
            "status": obj.status,
            "avatar_url": obj.avatar_url,
            "avatar_preview_url": obj.avatar_preview_url,
            "photos": [],
            "albums": []
        }
        
        if 'photos' not in insp.unloaded:
            data["photos"] = [UserPhoto.model_validate(p) for p in obj.photos]
        
        if 'albums' not in insp.unloaded:
            data["albums"] = [PhotoAlbum.model_validate(a) for a in obj.albums]
            
        return cls.model_construct(**data)


class RefreshTokenRequest(BaseModel):
    refresh_token: str




