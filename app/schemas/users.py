from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, ConfigDict, field_validator
from typing import Any


class UserCreate(BaseModel):
    email: EmailStr = Field(description="Email пользователя")
    password: str = Field(min_length=8, description="Пароль (минимум 8 символов)")
    first_name: str | None = Field(default=None, description="Имя")
    last_name: str | None = Field(default=None, description="Фамилия")
    role: str = Field(default="buyer", pattern="^(buyer|seller|admin|owner)$",
                      description="Роль: 'buyer', 'seller', 'admin' или 'owner'")


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    first_name: str | None = None
    last_name: str | None = None
    role: str | None = None
    status: str | None = None


class UserPhotoBase(BaseModel):
    image_url: str
    preview_url: str
    description: str | None = None
    album_id: int | None = None
    is_private: bool = False

class UserPhotoCreate(UserPhotoBase):
    pass

class UserPhotoUpdate(BaseModel):
    description: str | None = None
    album_id: int | None = None
    is_private: bool | None = None

class BulkDeletePhotosRequest(BaseModel):
    photo_ids: list[int]

class UserPhoto(UserPhotoBase):
    id: int
    created_at: datetime | None = None
    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def model_validate(cls, obj, **kwargs):
        try:
            if isinstance(obj, dict):
                # Ensure mandatory fields have defaults if missing in dict
                data = {
                    "image_url": obj.get("image_url", ""),
                    "preview_url": obj.get("preview_url", ""),
                    "description": obj.get("description"),
                    "album_id": obj.get("album_id"),
                    "is_private": obj.get("is_private", False),
                    "id": obj.get("id", 0),
                    "created_at": obj.get("created_at"),
                }
                return cls(**data)
            
            # Базовые поля
            data = {
                "image_url": str(getattr(obj, "image_url", "")),
                "preview_url": str(getattr(obj, "preview_url", "")),
                "description": getattr(obj, "description", None),
                "album_id": getattr(obj, "album_id", None),
                "is_private": bool(getattr(obj, "is_private", False)),
                "id": int(getattr(obj, "id", 0)),
                "created_at": getattr(obj, "created_at", None),
            }
            return cls(**data)
        except Exception as e:
            raise e


class PhotoAlbumBase(BaseModel):
    title: str
    description: str | None = None
    is_private: bool = False

class PhotoAlbumCreate(PhotoAlbumBase):
    pass

class PhotoAlbumUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    is_private: bool | None = None

class PhotoAlbum(PhotoAlbumBase):
    id: int
    user_id: int
    created_at: datetime | None = None
    photos: list[UserPhoto] = []
    
    # Для превью альбома (последняя фотография)
    album_preview_url: str | None = None
    
    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def model_validate(cls, obj, **kwargs):
        try:
            if isinstance(obj, dict):
                data = {
                    "id": obj.get("id", 0),
                    "user_id": obj.get("user_id", 0),
                    "title": obj.get("title", ""),
                    "description": obj.get("description"),
                    "is_private": obj.get("is_private", False),
                    "created_at": obj.get("created_at"),
                    "photos": obj.get("photos", []),
                    "album_preview_url": obj.get("album_preview_url")
                }
                # Ensure photos are also validated if they are dicts
                if data["photos"] and isinstance(data["photos"][0], dict):
                    data["photos"] = [UserPhoto.model_validate(p) for p in data["photos"]]
                return cls(**data)
                
            # Базовые поля
            data = {
                "id": int(getattr(obj, "id", 0)),
                "user_id": int(getattr(obj, "user_id", 0)),
                "title": str(getattr(obj, "title", "")),
                "description": getattr(obj, "description", None),
                "is_private": bool(getattr(obj, "is_private", False)),
                "created_at": getattr(obj, "created_at", None),
                "photos": [],
                "album_preview_url": None
            }
            
            # Пытаемся достать фото из __dict__ напрямую, чтобы не триггерить lazy load
            obj_dict = getattr(obj, "__dict__", {})
            if "photos" in obj_dict:
                photos = obj_dict["photos"]
                data["photos"] = [UserPhoto.model_validate(p) for p in photos] if photos else []
                
                # Set preview url from the latest photo
                if data["photos"]:
                    valid_for_preview = [p for p in data["photos"] if p.created_at is not None]
                    if valid_for_preview:
                        sorted_photos = sorted(valid_for_preview, key=lambda x: x.created_at, reverse=True)
                        data["album_preview_url"] = sorted_photos[0].preview_url
                    else:
                        data["album_preview_url"] = data["photos"][0].preview_url
            
            return cls(**data)
        except Exception as e:
            print(f"DEBUG: Error in PhotoAlbum.model_validate: {e}")
            return cls(
                id=int(getattr(obj, "id", 0)),
                user_id=int(getattr(obj, "user_id", 0)),
                title=str(getattr(obj, "title", "Error")),
                photos=[]
            )


class AdminPermissionCreate(BaseModel):
    admin_id: int
    model_name: str

class AdminPermission(BaseModel):
    id: int
    admin_id: int
    model_name: str
    model_config = ConfigDict(from_attributes=True)


class User(BaseModel):
    id: int
    email: str # Changed from EmailStr to str for flexibility
    first_name: str | None = None
    last_name: str | None = None
    is_active: bool = True
    role: str = "buyer"
    status: str | None = "offline"
    last_seen: str | None = None
    avatar_url: str | None = None
    avatar_preview_url: str | None = None
    fcm_token: str | None = None
    friendship_status: str | None = None # "pending", "accepted", "requested_by_me", "requested_by_them", null
    photos: list[UserPhoto] = []
    albums: list[PhotoAlbum] = []
    admin_permissions: list[AdminPermission] = []
    update_available: bool = False
    latest_app_version: 'AppVersionResponse | None' = None
    
    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def model_validate(cls, obj, **kwargs):
        try:
            if isinstance(obj, dict):
                # Ensure mandatory fields have defaults if missing in dict
                data = {
                    "id": obj.get("id", 0),
                    "email": obj.get("email", ""),
                    "first_name": obj.get("first_name"),
                    "last_name": obj.get("last_name"),
                    "is_active": obj.get("is_active", True),
                    "role": obj.get("role", "buyer"),
                    "status": obj.get("status", "offline"),
                    "last_seen": obj.get("last_seen"),
                    "avatar_url": obj.get("avatar_url"),
                    "avatar_preview_url": obj.get("avatar_preview_url"),
                    "fcm_token": obj.get("fcm_token"),
                    "friendship_status": obj.get("friendship_status"),
                    "photos": obj.get("photos", []),
                    "albums": obj.get("albums", []),
                    "admin_permissions": obj.get("admin_permissions", []),
                    "update_available": obj.get("update_available", False),
                    "latest_app_version": obj.get("latest_app_version")
                }
                return cls(**data)
                
            # Получаем базовые поля
            data = {
                "id": int(getattr(obj, "id", 0)),
                "email": str(getattr(obj, "email", "")),
                "first_name": getattr(obj, "first_name", None),
                "last_name": getattr(obj, "last_name", None),
                "is_active": bool(getattr(obj, "is_active", True)),
                "role": str(getattr(obj, "role", "buyer")),
                "status": str(getattr(obj, "status", "offline")),
                "last_seen": getattr(obj, "last_seen", None),
                "avatar_url": getattr(obj, "avatar_url", None),
                "avatar_preview_url": getattr(obj, "avatar_preview_url", None),
                "fcm_token": getattr(obj, "fcm_token", None),
                "friendship_status": getattr(obj, "friendship_status", None),
                "photos": [],
                "albums": [],
                "admin_permissions": [],
                "update_available": getattr(obj, "update_available", False),
                "latest_app_version": getattr(obj, "latest_app_version", None)
            }
            
            # Используем __dict__ напрямую, это самый надежный способ избежать ленивой загрузки
            obj_dict = getattr(obj, "__dict__", {})
            
            if "photos" in obj_dict:
                photos = obj_dict["photos"]
                data["photos"] = [UserPhoto.model_validate(p) for p in photos] if photos else []
            
            if "albums" in obj_dict:
                albums = obj_dict["albums"]
                data["albums"] = [PhotoAlbum.model_validate(a) for a in albums] if albums else []

            if "admin_permissions" in obj_dict:
                perms = obj_dict["admin_permissions"]
                data["admin_permissions"] = [AdminPermission.model_validate(p) for p in perms] if perms else []
                
            return cls(**data)
        except Exception as e:
            print(f"DEBUG: Error in User.model_validate: {e}")
            return cls(
                id=int(getattr(obj, "id", 0)),
                email=str(getattr(obj, "email", "error@validate.err")),
                first_name="Error",
                last_name="Validation"
            )


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class FCMTokenUpdate(BaseModel):
    fcm_token: str


class Friendship(BaseModel):
    id: int
    user_id: int
    friend_id: int
    status: str
    created_at: datetime
    
    # deleted_by_id опционален на случай если его нет в БД
    deleted_by_id: int | None = None

    model_config = ConfigDict(from_attributes=True)


class AppVersionResponse(BaseModel):
    id: int
    version: str
    file_path: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)




