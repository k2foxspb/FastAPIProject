import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi.security import OAuth2PasswordRequestForm

from app.core.config import SECRET_KEY, ALGORITHM
from app.models.users import User as UserModel, PhotoAlbum as PhotoAlbumModel, UserPhoto as UserPhotoModel
from app.schemas.users import UserCreate, User as UserSchema, RefreshTokenRequest, PhotoAlbumCreate, PhotoAlbum as PhotoAlbumSchema, UserPhotoCreate, UserPhoto as UserPhotoSchema
from app.api.dependencies import get_async_db
from app.core.auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    get_current_user,
    verify_refresh_token
)

from sqlalchemy.orm import selectinload

router = APIRouter(prefix="/users", tags=["users"])


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
    await db.refresh(db_album)
    return db_album


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


