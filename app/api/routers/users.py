import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi.security import OAuth2PasswordRequestForm

from app.core.config import SECRET_KEY, ALGORITHM
from app.models.users import User as UserModel, PhotoAlbum as PhotoAlbumModel, UserPhoto as UserPhotoModel
from app.schemas.users import (
    UserCreate, User as UserSchema, RefreshTokenRequest, 
    PhotoAlbumCreate, PhotoAlbumUpdate, PhotoAlbum as PhotoAlbumSchema, 
    UserPhotoCreate, UserPhotoUpdate, UserPhoto as UserPhotoSchema
)
from app.api.dependencies import get_async_db
from app.core.auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    get_current_user,
    verify_refresh_token
)

import os
import uuid
import io
from PIL import Image
from fastapi import UploadFile, File, Form

from sqlalchemy.orm import selectinload

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/", response_model=list[UserSchema])
async def get_users(
    search: str | None = None,
    db: AsyncSession = Depends(get_async_db)
):
    """
    Возвращает список всех активных пользователей.
    """
    query = select(UserModel).where(UserModel.is_active == True)
    if search:
        query = query.where(UserModel.email.ilike(f"%{search}%"))
    
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{user_id}", response_model=UserSchema)
async def get_user_profile(
    user_id: int,
    db: AsyncSession = Depends(get_async_db)
):
    """
    Возвращает публичный профиль пользователя по его ID.
    """
    result = await db.execute(
        select(UserModel).where(UserModel.id == user_id, UserModel.is_active == True).options(
            selectinload(UserModel.photos),
            selectinload(UserModel.albums).selectinload(PhotoAlbumModel.photos)
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.get("/me", response_model=UserSchema)
async def get_me(current_user: UserModel = Depends(get_current_user), db: AsyncSession = Depends(get_async_db)):
    """
    Возвращает информацию о текущем пользователе, включая его альбомы и фотографии.
    """
    # Загружаем фотографии и альбомы пользователя
    result = await db.execute(
        select(UserModel).where(UserModel.id == current_user.id).options(
            selectinload(UserModel.photos),
            selectinload(UserModel.albums).selectinload(PhotoAlbumModel.photos)
        )
    )
    user = result.scalar_one_or_none()
    return user


@router.post("/", response_model=UserSchema, status_code=status.HTTP_201_CREATED)
async def create_user(user: UserCreate, db: AsyncSession = Depends(get_async_db)):
    """
    Регистрирует нового пользователя с ролью 'buyer' или 'seller'.
    """
    # Проверка уникальности email
    result = await db.scalars(select(UserModel).where(UserModel.email == user.email))
    if result.first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Email already registered")

    # Создание объекта пользователя с хешированным паролем
    db_user = UserModel(
        email=user.email,
        hashed_password=hash_password(user.password),
        role=user.role
    )

    # Добавление в сессию и сохранение в базе
    db.add(db_user)
    await db.commit()
    return db_user


@router.post("/token")
async def login(form_data: OAuth2PasswordRequestForm = Depends(),
                db: AsyncSession = Depends(get_async_db)):
    """
    Аутентифицирует пользователя и возвращает JWT с email, role и id.
    """
    result = await db.scalars(
        select(UserModel).where(UserModel.email == form_data.username, UserModel.is_active == True))
    user = result.first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(data={"sub": user.email, "role": user.role, "id": user.id})
    refresh_token = create_refresh_token(data={"sub": user.email, "role": user.role, "id": user.id})
    return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer"}

@router.post("/refresh-token")
async def refresh_token(
    body: RefreshTokenRequest,
    db: AsyncSession = Depends(get_async_db),
):
    """
    Обновляет refresh-токен, принимая старый refresh-токен в теле запроса.
    """
    user = await verify_refresh_token(body.refresh_token, db)

    # Генерируем новый refresh-токен
    new_refresh_token = create_refresh_token(
        data={"sub": user.email, "role": user.role, "id": user.id}
    )

    return {
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
    }


@router.post("/refresh-token-access")
async def refresh_token_access(
    body: RefreshTokenRequest,
    db: AsyncSession = Depends(get_async_db),
):
    """
    Обновляет access-токен, принимая refresh-токен в теле запроса.
    """
    user = await verify_refresh_token(body.refresh_token, db)

    # Генерируем новый access-токен
    new_access_token = create_access_token(
        data={"sub": user.email, "role": user.role, "id": user.id}
    )

    return {
        "access_token": new_access_token,
        "token_type": "bearer",
    }


@router.post("/albums", response_model=PhotoAlbumSchema, status_code=status.HTTP_201_CREATED)
async def create_album(
    album: PhotoAlbumCreate,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Создает новый фотоальбом для текущего пользователя.
    """
    db_album = PhotoAlbumModel(
        user_id=current_user.id,
        title=album.title,
        description=album.description
    )
    db.add(db_album)
    await db.commit()
    # Eagerly load photos for the response model
    result = await db.execute(
        select(PhotoAlbumModel).where(PhotoAlbumModel.id == db_album.id).options(
            selectinload(PhotoAlbumModel.photos)
        )
    )
    return result.scalar_one()


@router.post("/photos", response_model=UserPhotoSchema, status_code=status.HTTP_201_CREATED)
async def add_photo(
    photo: UserPhotoCreate,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Добавляет фотографию текущему пользователю. Можно указать album_id.
    """
    if photo.album_id:
        result = await db.execute(
            select(PhotoAlbumModel).where(
                PhotoAlbumModel.id == photo.album_id,
                PhotoAlbumModel.user_id == current_user.id
            )
        )
        album = result.scalar_one_or_none()
        if not album:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Album not found")

    db_photo = UserPhotoModel(
        user_id=current_user.id,
        album_id=photo.album_id,
        image_url=photo.image_url,
        preview_url=photo.preview_url,
        description=photo.description
    )
    db.add(db_photo)
    await db.commit()
    await db.refresh(db_photo)
    return db_photo


@router.get("/albums", response_model=list[PhotoAlbumSchema])
async def get_my_albums(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Возвращает список альбомов текущего пользователя.
    """
    result = await db.execute(
        select(PhotoAlbumModel).where(PhotoAlbumModel.user_id == current_user.id).options(
            selectinload(PhotoAlbumModel.photos)
        )
    )
    return result.scalars().all()


@router.get("/albums/{album_id}", response_model=PhotoAlbumSchema)
async def get_album(
    album_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Возвращает информацию о конкретном альбоме текущего пользователя.
    """
    result = await db.execute(
        select(PhotoAlbumModel).where(
            PhotoAlbumModel.id == album_id,
            PhotoAlbumModel.user_id == current_user.id
        ).options(selectinload(PhotoAlbumModel.photos))
    )
    album = result.scalar_one_or_none()
    if not album:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Album not found")
    return album


@router.patch("/albums/{album_id}", response_model=PhotoAlbumSchema)
async def update_album(
    album_id: int,
    album_update: PhotoAlbumUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Обновляет информацию об альбоме.
    """
    result = await db.execute(
        select(PhotoAlbumModel).where(
            PhotoAlbumModel.id == album_id,
            PhotoAlbumModel.user_id == current_user.id
        )
    )
    db_album = result.scalar_one_or_none()
    if not db_album:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Album not found")

    update_data = album_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_album, key, value)

    await db.commit()
    # Eagerly load photos for the response model
    result = await db.execute(
        select(PhotoAlbumModel).where(PhotoAlbumModel.id == db_album.id).options(
            selectinload(PhotoAlbumModel.photos)
        )
    )
    return result.scalar_one()


@router.delete("/albums/{album_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_album(
    album_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Удаляет альбом пользователя. Фотографии удаляются каскадно.
    """
    result = await db.execute(
        select(PhotoAlbumModel).where(
            PhotoAlbumModel.id == album_id,
            PhotoAlbumModel.user_id == current_user.id
        )
    )
    db_album = result.scalar_one_or_none()
    if not db_album:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Album not found")

    await db.delete(db_album)
    await db.commit()
    return None


BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
USER_MEDIA_ROOT = os.path.join(BASE_DIR, "app", "media", "users")
os.makedirs(USER_MEDIA_ROOT, exist_ok=True)

async def save_user_photo(file: UploadFile) -> tuple[str, str]:
    file_extension = os.path.splitext(file.filename)[1]
    unique_filename = f"{uuid.uuid4()}{file_extension}"
    file_path = os.path.join(USER_MEDIA_ROOT, unique_filename)
    
    content = await file.read()
    with open(file_path, "wb") as buffer:
        buffer.write(content)
    
    # Миниатюра
    thumb_filename = f"{os.path.splitext(unique_filename)[0]}_thumb{file_extension}"
    thumb_path = os.path.join(USER_MEDIA_ROOT, thumb_filename)
    try:
        with Image.open(io.BytesIO(content)) as img:
            img.thumbnail((400, 400))
            img.save(thumb_path)
    except Exception:
        thumb_filename = unique_filename
        
    return f"/media/users/{unique_filename}", f"/media/users/{thumb_filename}"


@router.post("/photos/upload", response_model=UserPhotoSchema, status_code=status.HTTP_201_CREATED)
async def upload_photo(
    file: UploadFile = File(...),
    description: str | None = Form(None),
    album_id: int | None = Form(None),
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Загружает фотографию на сервер и создает запись в базе данных.
    """
    if album_id:
        result = await db.execute(
            select(PhotoAlbumModel).where(
                PhotoAlbumModel.id == album_id,
                PhotoAlbumModel.user_id == current_user.id
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Album not found")

    image_url, preview_url = await save_user_photo(file)

    db_photo = UserPhotoModel(
        user_id=current_user.id,
        album_id=album_id,
        image_url=image_url,
        preview_url=preview_url,
        description=description
    )
    db.add(db_photo)
    await db.commit()
    await db.refresh(db_photo)
    return db_photo


@router.get("/photos/{photo_id}", response_model=UserPhotoSchema)
async def get_photo(
    photo_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Возвращает информацию о фотографии.
    """
    result = await db.execute(
        select(UserPhotoModel).where(
            UserPhotoModel.id == photo_id,
            UserPhotoModel.user_id == current_user.id
        )
    )
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")
    return photo


@router.patch("/photos/{photo_id}", response_model=UserPhotoSchema)
async def update_photo(
    photo_id: int,
    photo_update: UserPhotoUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Обновляет описание или альбом фотографии.
    """
    result = await db.execute(
        select(UserPhotoModel).where(
            UserPhotoModel.id == photo_id,
            UserPhotoModel.user_id == current_user.id
        )
    )
    db_photo = result.scalar_one_or_none()
    if not db_photo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")

    update_data = photo_update.model_dump(exclude_unset=True)
    
    if "album_id" in update_data and update_data["album_id"] is not None:
        # Проверяем что альбом принадлежит пользователю
        album_result = await db.execute(
            select(PhotoAlbumModel).where(
                PhotoAlbumModel.id == update_data["album_id"],
                PhotoAlbumModel.user_id == current_user.id
            )
        )
        if not album_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target album not found")

    for key, value in update_data.items():
        setattr(db_photo, key, value)

    await db.commit()
    await db.refresh(db_photo)
    return db_photo


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_photo(
    photo_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Удаляет фотографию пользователя.
    """
    result = await db.execute(
        select(UserPhotoModel).where(
            UserPhotoModel.id == photo_id,
            UserPhotoModel.user_id == current_user.id
        )
    )
    db_photo = result.scalar_one_or_none()
    if not db_photo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")

    await db.delete(db_photo)
    await db.commit()
    
    # Удаление файлов с диска
    try:
        # Получаем пути
        relative_image = db_photo.image_url.lstrip("/")
        relative_preview = db_photo.preview_url.lstrip("/")
        
        image_path = os.path.join(BASE_DIR, "app", relative_image)
        preview_path = os.path.join(BASE_DIR, "app", relative_preview)
        
        if os.path.exists(image_path):
            os.remove(image_path)
        if os.path.exists(preview_path) and preview_path != image_path:
            os.remove(preview_path)
    except Exception as e:
        print(f"Error deleting files: {e}")
        
    return None


