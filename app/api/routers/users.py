import jwt
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, or_, and_
from fastapi.security import OAuth2PasswordRequestForm

from app.core.config import SECRET_KEY, ALGORITHM
from app.models.users import (
    User as UserModel, 
    PhotoAlbum as PhotoAlbumModel, 
    UserPhoto as UserPhotoModel,
    Friendship as FriendshipModel
)
from app.schemas.users import (
    UserCreate, UserUpdate, User as UserSchema, RefreshTokenRequest, 
    PhotoAlbumCreate, PhotoAlbumUpdate, PhotoAlbum as PhotoAlbumSchema, 
    UserPhotoCreate, UserPhotoUpdate, UserPhoto as UserPhotoSchema,
    FCMTokenUpdate, BulkDeletePhotosRequest, Friendship as FriendshipSchema
)
from app.api.dependencies import get_async_db
from app.core.auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    get_current_user,
    get_current_user_optional,
    verify_refresh_token
)
from app.api.routers.notifications import manager as notification_manager
from app.core.fcm import send_fcm_notification
from app.utils.emails import send_verification_email
from app.tasks.example_tasks import send_verification_email_task

import os
import uuid
import io
from PIL import Image
from fastapi import UploadFile, File, Form
from datetime import datetime

from sqlalchemy.orm import selectinload

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserSchema])
@router.get("/", response_model=list[UserSchema], include_in_schema=False)
async def get_users(
    search: str | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel | None = Depends(get_current_user_optional)
):
    """
    Возвращает список всех активных пользователей.
    """
    query = select(UserModel).where(UserModel.is_active == True).options(
        selectinload(UserModel.photos),
        selectinload(UserModel.albums).selectinload(PhotoAlbumModel.photos),
        selectinload(UserModel.sent_friend_requests),
        selectinload(UserModel.received_friend_requests)
    )
    if search:
        query = query.where(UserModel.email.ilike(f"%{search}%"))
    
    result = await db.execute(query)
    users = result.scalars().all()

    # Скрываем приватный контент для общего списка
    for user in users:
        user.photos = [p for p in user.photos if not p.is_private]
        user.albums = [a for a in user.albums if not a.is_private]
        for album in user.albums:
            album.photos = [p for p in album.photos if not p.is_private]
        
        # Определяем статус дружбы
        if current_user:
            if user.id == current_user.id:
                user.friendship_status = "self"
            else:
                # Ищем среди отправленных текущим пользователем
                res_sent = await db.execute(
                    select(FriendshipModel).where(
                        FriendshipModel.user_id == current_user.id,
                        FriendshipModel.friend_id == user.id
                    )
                )
                friendship = res_sent.scalar_one_or_none()
                if friendship:
                    if friendship.status == "accepted":
                        user.friendship_status = "accepted"
                    else:
                        user.friendship_status = "requested_by_me"
                else:
                    # Ищем среди полученных текущим пользователем
                    res_received = await db.execute(
                        select(FriendshipModel).where(
                            FriendshipModel.user_id == user.id,
                            FriendshipModel.friend_id == current_user.id
                        )
                    )
                    friendship = res_received.scalar_one_or_none()
                    if friendship:
                        if friendship.status == "accepted":
                            user.friendship_status = "accepted"
                        else:
                            user.friendship_status = "requested_by_them"
                    else:
                        user.friendship_status = None

    return [UserSchema.model_validate(u) for u in users]


@router.get("/me")
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
    
    try:
        # Пытаемся валидировать вручную для отладки, если возникнет ошибка
        print(f"DEBUG: Manual validation for user {user.email}")
        validated_user = UserSchema.model_validate(user)
        print(f"DEBUG: Manual validation success for {user.email}")
        return validated_user
    except Exception as e:
        print(f"Validation error in get_me for {user.email}: {e}")
        # Если Pydantic бросает ValidationError, мы увидим детали
        import traceback
        traceback.print_exc()
        # Возвращаем словарь напрямую, чтобы избежать повторной валидации response_model
        data = {
            "id": int(getattr(user, "id", 0)),
            "email": str(getattr(user, "email", "")),
            "first_name": getattr(user, "first_name", None),
            "last_name": getattr(user, "last_name", None),
            "is_active": bool(getattr(user, "is_active", True)),
            "role": str(getattr(user, "role", "buyer")),
            "status": str(getattr(user, "status", "offline")),
            "avatar_url": getattr(user, "avatar_url", None),
            "avatar_preview_url": getattr(user, "avatar_preview_url", None),
            "photos": [],
            "albums": []
        }
        return data


@router.patch("/me", response_model=UserSchema)
async def update_me(
    email: str | None = Form(None),
    first_name: str | None = Form(None),
    last_name: str | None = Form(None),
    role: str | None = Form(None),
    status: str | None = Form(None),
    avatar: UploadFile = File(None),
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Обновляет информацию о текущем пользователе.
    """
    if email:
        current_user.email = email
    if first_name is not None:
        current_user.first_name = first_name
    if last_name is not None:
        current_user.last_name = last_name
    if role:
        current_user.role = role
    if status:
        current_user.status = status
    
    if avatar:
        # Сохраняем аватарку (используем существующую функцию сохранения фото)
        image_url, preview_url = await save_user_photo(avatar)
        current_user.avatar_url = image_url
        current_user.avatar_preview_url = preview_url

        # Добавляем аватарку в историю (альбом "Аватарки")
        # Ищем существующий альбом
        album_res = await db.execute(
            select(PhotoAlbumModel).where(
                PhotoAlbumModel.user_id == current_user.id,
                PhotoAlbumModel.title == "Аватарки"
            )
        )
        avatar_album = album_res.scalar_one_or_none()
        
        if not avatar_album:
            avatar_album = PhotoAlbumModel(
                user_id=current_user.id,
                title="Аватарки",
                description="История моих аватарок",
                is_private=False
            )
            db.add(avatar_album)
            await db.flush() # Получаем ID альбома
            
        # Создаем запись о фото
        new_avatar_photo = UserPhotoModel(
            user_id=current_user.id,
            album_id=avatar_album.id,
            image_url=image_url,
            preview_url=preview_url,
            description=f"Аватарка от {datetime.now().strftime('%d.%m.%Y %H:%M')}",
            is_private=False
        )
        db.add(new_avatar_photo)
    
    await db.commit()
    await db.refresh(current_user)
    
    # Подгружаем связанные данные для схемы
    result = await db.execute(
        select(UserModel).where(UserModel.id == current_user.id).options(
            selectinload(UserModel.photos),
            selectinload(UserModel.albums).selectinload(PhotoAlbumModel.photos)
        )
    )
    user = result.scalar_one()
    return UserSchema.model_validate(user)


@router.post("/", response_model=UserSchema, status_code=status.HTTP_201_CREATED)
@router.post("", response_model=UserSchema, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_user(user: UserCreate, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_async_db)):
    """
    Регистрирует нового пользователя с ролью 'buyer' или 'seller'.
    Если пользователь с таким email уже существует и не активен, повторно отправляет письмо для подтверждения.
    """
    print(f"DEBUG: create_user called for email: {user.email}")
    # Проверка существования пользователя
    result = await db.execute(select(UserModel).where(UserModel.email == user.email))
    existing_user = result.scalar_one_or_none()

    if existing_user:
        if not existing_user.is_active:
            # Если пользователь не активен, генерируем новый токен и отправляем письмо повторно
            verification_token = create_access_token(data={"sub": existing_user.email, "type": "verification"})
            
            # Отправка письма через Celery
            try:
                send_verification_email_task.delay(existing_user.email, verification_token)
            except Exception as e:
                print(f"Error sending email task for existing user: {e}")
                # Если Celery упал, отправим асинхронно через FastAPI как запасной вариант
                background_tasks.add_task(send_verification_email, existing_user.email, verification_token)
            
            # Возвращаем существующего пользователя с 200 OK
            # Но так как у нас status_code=201_CREATED захардкожен в декораторе, 
            # мы можем либо сменить декоратор, либо оставить как есть. 
            # FastAPI позволяет вернуть Response для переопределения статуса.
            from fastapi.responses import JSONResponse
            from fastapi.encoders import jsonable_encoder
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "message": "User already registered but not verified. Verification email resent.",
                    "user": jsonable_encoder(UserSchema.model_validate(existing_user))
                }
            )
        
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Email already registered")

    # Запрещаем регистрацию как owner или admin через обычный эндпоинт
    if user.role in ["owner", "admin"]:
         raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Cannot register as owner or admin via this endpoint")

    # Создание объекта пользователя с хешированным паролем
    # is_active=False по умолчанию в модели
    db_user = UserModel(
        email=user.email,
        hashed_password=hash_password(user.password),
        first_name=user.first_name,
        last_name=user.last_name,
        role=user.role
    )

    # Добавление в сессию и сохранение в базе
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)

    # Генерация токена подтверждения
    verification_token = create_access_token(data={"sub": db_user.email, "type": "verification"})
    
    # Отправка письма
    print(f"DEBUG: Attempting to send verification email to {db_user.email} via Celery")
    try:
        task = send_verification_email_task.delay(db_user.email, verification_token)
        print(f"DEBUG: Celery task sent successfully. Task ID: {task.id}")
    except Exception as e:
        print(f"Failed to send verification email via Celery: {e}")
        import traceback
        traceback.print_exc()
        # Запасной вариант - фоновая задача FastAPI
        background_tasks.add_task(send_verification_email, db_user.email, verification_token)

    return UserSchema.model_validate(db_user)


@router.get("/test-email-send")
async def test_email_send(email: str, background_tasks: BackgroundTasks):
    """
    Эндпоинт для проверки отправки почты через Celery.
    """
    token = "test-token-123"
    try:
        send_verification_email_task.delay(email, token)
        message = f"Test email scheduled via Celery for {email}."
    except Exception as e:
        print(f"Test email Celery failed: {e}")
        background_tasks.add_task(send_verification_email, email, token)
        message = f"Test email scheduled via FastAPI BackgroundTasks for {email} (Celery failed)."
    
    return {"message": message}


@router.get("/verify-email")
async def verify_email(token: str, db: AsyncSession = Depends(get_async_db)):
    """
    Подтверждает email пользователя по токену.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        token_type: str = payload.get("type")
        if email is None or token_type != "verification":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Token has expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token")

    result = await db.scalars(select(UserModel).where(UserModel.email == email))
    user = result.first()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    if user.is_active:
        return {"message": "Email already verified"}

    user.is_active = True
    await db.commit()

    return {"message": "Email successfully verified"}


@router.post("/token")
@router.post("/token/", include_in_schema=False)
async def login(form_data: OAuth2PasswordRequestForm = Depends(),
                db: AsyncSession = Depends(get_async_db)):
    """
    Аутентифицирует пользователя и возвращает JWT с email, role и id.
    """
    result = await db.execute(select(UserModel).where(UserModel.email == form_data.username))
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email not verified. Please check your email for verification link.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(data={"sub": user.email, "role": user.role, "id": user.id})
    refresh_token = create_refresh_token(data={"sub": user.email, "role": user.role, "id": user.id})
    print(f"DEBUG: Created tokens for {user.email}: access={access_token[:20]}... refresh={refresh_token[:20]}...")
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
        description=album.description,
        is_private=album.is_private
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
        description=photo.description,
        is_private=photo.is_private
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
    albums = result.scalars().all()
    
    try:
        validated_albums = [PhotoAlbumSchema.model_validate(a) for a in albums]
        return validated_albums
    except Exception as e:
        raise e


@router.get("/albums/{album_id}", response_model=PhotoAlbumSchema)
async def get_album(
    album_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Возвращает информацию о конкретном альбоме.
    Если альбом приватный, доступ разрешен только владельцу.
    """
    from sqlalchemy import or_
    result = await db.execute(
        select(PhotoAlbumModel).where(
            PhotoAlbumModel.id == album_id,
            or_(
                PhotoAlbumModel.user_id == current_user.id,
                PhotoAlbumModel.is_private == False
            )
        ).options(selectinload(PhotoAlbumModel.photos))
    )
    album = result.scalar_one_or_none()
    if not album:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Album not found or access denied")
    
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


@router.post("/fcm-token", response_model=dict)
async def update_fcm_token(
    body: FCMTokenUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Обновляет FCM токен для текущего пользователя.
    """
    current_user.fcm_token = body.fcm_token
    await db.commit()
    return {"status": "ok"}


# Настройка путей для медиа
# Мы используем абсолютный путь относительно корня приложения (папка app)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
USER_MEDIA_ROOT = os.path.join(BASE_DIR, "media", "users")
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
    is_private: bool = Form(False),
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Загружает фотографию на сервер и создает запись в базе данных.
    """
    print(f"DEBUG: upload_photo called by {current_user.email}")
    print(f"DEBUG: file: {file.filename}, size: {file.size if hasattr(file, 'size') else 'unknown'}")
    if album_id:
        print(f"DEBUG: album_id: {album_id}")
        result = await db.execute(
            select(PhotoAlbumModel).where(
                PhotoAlbumModel.id == album_id,
                PhotoAlbumModel.user_id == current_user.id
            )
        )
        if not result.scalar_one_or_none():
            print(f"DEBUG: Album {album_id} not found for user {current_user.id}")
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Album not found")

    try:
        image_url, preview_url = await save_user_photo(file)
        print(f"DEBUG: Photo saved: {image_url}, {preview_url}")
    except Exception as e:
        print(f"DEBUG: Error saving photo: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error saving photo: {str(e)}")

    db_photo = UserPhotoModel(
        user_id=current_user.id,
        album_id=album_id,
        image_url=image_url,
        preview_url=preview_url,
        description=description,
        is_private=is_private
    )
    db.add(db_photo)
    await db.commit()
    await db.refresh(db_photo)
    print(f"DEBUG: Photo record created in DB: {db_photo.id}")
    return db_photo


@router.post("/photos/bulk-upload", response_model=list[UserPhotoSchema], status_code=status.HTTP_201_CREATED)
async def bulk_upload_photos(
    files: list[UploadFile] = File(...),
    description: str | None = Form(None),
    album_id: int | None = Form(None),
    is_private: bool = Form(False),
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Загружает несколько фотографий на сервер и создает записи в базе данных.
    """
    print(f"DEBUG: bulk_upload_photos called by {current_user.email}, count: {len(files)}")
    
    if album_id:
        result = await db.execute(
            select(PhotoAlbumModel).where(
                PhotoAlbumModel.id == album_id,
                PhotoAlbumModel.user_id == current_user.id
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Album not found")

    db_photos = []
    for file in files:
        try:
            image_url, preview_url = await save_user_photo(file)
            db_photo = UserPhotoModel(
                user_id=current_user.id,
                album_id=album_id,
                image_url=image_url,
                preview_url=preview_url,
                description=description,
                is_private=is_private
            )
            db.add(db_photo)
            db_photos.append(db_photo)
        except Exception as e:
            print(f"DEBUG: Error saving photo {file.filename}: {e}")
            # В случае ошибки с одним файлом продолжаем с другими или прерываем? 
            # Для простоты прервем, если это критично, или просто пропустим.
            # Здесь выберем прерывание с откатом (транзакция db поможет).
            raise HTTPException(status_code=500, detail=f"Error saving photo {file.filename}: {str(e)}")

    await db.commit()
    for photo in db_photos:
        await db.refresh(photo)
        
    return db_photos


@router.get("/photos/{photo_id}", response_model=UserPhotoSchema)
async def get_photo(
    photo_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Возвращает информацию о фотографии.
    Если фото приватное, доступ разрешен только владельцу.
    """
    from sqlalchemy import or_
    result = await db.execute(
        select(UserPhotoModel).where(
            UserPhotoModel.id == photo_id,
            or_(
                UserPhotoModel.user_id == current_user.id,
                UserPhotoModel.is_private == False
            )
        )
    )
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found or access denied")
    
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
        
        image_path = os.path.join(BASE_DIR, relative_image)
        preview_path = os.path.join(BASE_DIR, relative_preview)
        
        if os.path.exists(image_path):
            os.remove(image_path)
        if os.path.exists(preview_path) and preview_path != image_path:
            os.remove(preview_path)
    except Exception as e:
        print(f"Error deleting files: {e}")
        
    return None


@router.post("/photos/bulk-delete", status_code=status.HTTP_204_NO_CONTENT)
async def bulk_delete_photos(
    request: BulkDeletePhotosRequest,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Удаляет несколько фотографий пользователя за один запрос.
    """
    result = await db.execute(
        select(UserPhotoModel).where(
            UserPhotoModel.id.in_(request.photo_ids),
            UserPhotoModel.user_id == current_user.id
        )
    )
    db_photos = result.scalars().all()
    
    if not db_photos:
        return None

    # Сохраняем пути к файлам перед удалением из базы
    paths_to_delete = []
    for photo in db_photos:
        paths_to_delete.append(photo.image_url)
        paths_to_delete.append(photo.preview_url)
        await db.delete(photo)
    
    await db.commit()
    
    # Удаление файлов с диска
    for path in paths_to_delete:
        try:
            relative_path = path.lstrip("/")
            full_path = os.path.join(BASE_DIR, relative_path)
            if os.path.exists(full_path):
                os.remove(full_path)
        except Exception as e:
            print(f"Error deleting file {path}: {e}")
            
    return None


@router.get("/{user_id}", response_model=UserSchema)
@router.get("/{user_id}/", response_model=UserSchema, include_in_schema=False)
async def get_user_profile(
    user_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Возвращает публичный профиль пользователя по его ID.
    Приватные альбомы и фото скрываются, если запрашивает не владелец.
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
    
    # Если это не профиль текущего пользователя, фильтруем приватный контент
    if user.id != current_user.id:
        user.photos = [p for p in user.photos if not p.is_private]
        user.albums = [a for a in user.albums if not a.is_private]
        for album in user.albums:
            album.photos = [p for p in album.photos if not p.is_private]
            
    # Определяем статус дружбы
    res_friend = await db.execute(
        select(FriendshipModel).where(
            or_(
                and_(FriendshipModel.user_id == current_user.id, FriendshipModel.friend_id == user_id),
                and_(FriendshipModel.user_id == user_id, FriendshipModel.friend_id == current_user.id)
            )
        )
    )
    friendship = res_friend.scalar_one_or_none()
    
    friendship_status = None
    if friendship:
        if friendship.status == "accepted":
            friendship_status = "accepted"
        elif friendship.user_id == current_user.id:
            friendship_status = "requested_by_me"
        else:
            friendship_status = "requested_by_them"
            
    user_schema = UserSchema.model_validate(user)
    user_schema.friendship_status = friendship_status
    
    return user_schema


# --- Friends Endpoints ---

@router.post("/friends/request/{user_id}", response_model=FriendshipSchema)
@router.post("/friends/request/{user_id}/", response_model=FriendshipSchema, include_in_schema=False)
async def send_friend_request(
    user_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Отправляет заявку в друзья пользователю user_id.
    """
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot add yourself as a friend")

    # Проверяем, существует ли пользователь
    res = await db.execute(select(UserModel).where(UserModel.id == user_id))
    target_user = res.scalar_one_or_none()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Проверяем, нет ли уже отношений
    res = await db.execute(
        select(FriendshipModel).where(
            or_(
                and_(FriendshipModel.user_id == current_user.id, FriendshipModel.friend_id == user_id),
                and_(FriendshipModel.user_id == user_id, FriendshipModel.friend_id == current_user.id)
            )
        )
    )
    existing = res.scalar_one_or_none()
    if existing:
        return FriendshipSchema.model_validate(existing)

    new_friendship = FriendshipModel(
        user_id=current_user.id,
        friend_id=user_id,
        status="pending"
    )
    db.add(new_friendship)
    await db.commit()
    await db.refresh(new_friendship)

    # Уведомления
    msg = {
        "type": "friend_request",
        "sender_id": current_user.id,
        "sender_name": f"{current_user.first_name} {current_user.last_name}" if current_user.first_name else current_user.email,
        "message": "sent you a friend request"
    }
    await notification_manager.send_personal_message(msg, user_id)
    
    if target_user.fcm_token:
        await send_fcm_notification(
            token=target_user.fcm_token,
            title="Новая заявка в друзья",
            body=f"{msg['sender_name']} хочет добавить вас в друзья",
            data=msg
        )

    return new_friendship

@router.post("/friends/accept/{sender_id}", response_model=FriendshipSchema)
@router.post("/friends/accept/{sender_id}/", response_model=FriendshipSchema, include_in_schema=False)
async def accept_friend_request(
    sender_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Принимает заявку в друзья от sender_id.
    """
    res = await db.execute(
        select(FriendshipModel).where(
            FriendshipModel.user_id == sender_id,
            FriendshipModel.friend_id == current_user.id,
            FriendshipModel.status == "pending"
        )
    )
    friendship = res.scalar_one_or_none()
    if not friendship:
        raise HTTPException(status_code=404, detail="Friend request not found")

    friendship.status = "accepted"
    await db.commit()
    await db.refresh(friendship)

    # Уведомление отправителю
    res = await db.execute(select(UserModel).where(UserModel.id == sender_id))
    sender = res.scalar_one_or_none()
    
    msg = {
        "type": "friend_accept",
        "sender_id": current_user.id,
        "sender_name": f"{current_user.first_name} {current_user.last_name}" if current_user.first_name else current_user.email,
        "message": "accepted your friend request"
    }
    await notification_manager.send_personal_message(msg, sender_id)
    
    if sender and sender.fcm_token:
        await send_fcm_notification(
            token=sender.fcm_token,
            title="Заявка принята",
            body=f"{msg['sender_name']} принял вашу заявку в друзья",
            data=msg
        )

    return friendship

@router.post("/friends/reject/{sender_id}", status_code=204)
@router.post("/friends/reject/{sender_id}/", status_code=204, include_in_schema=False)
async def reject_friend_request(
    sender_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Отклоняет или удаляет заявку в друзья.
    """
    res = await db.execute(
        select(FriendshipModel).where(
            or_(
                and_(FriendshipModel.user_id == sender_id, FriendshipModel.friend_id == current_user.id),
                and_(FriendshipModel.user_id == current_user.id, FriendshipModel.friend_id == sender_id)
            )
        )
    )
    friendship = res.scalar_one_or_none()
    if friendship:
        await db.delete(friendship)
        await db.commit()
    return None

@router.delete("/friends/{friend_id}", status_code=204)
@router.delete("/friends/{friend_id}/", status_code=204, include_in_schema=False)
async def delete_friend(
    friend_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Удаляет пользователя из друзей.
    """
    res = await db.execute(
        select(FriendshipModel).where(
            or_(
                and_(FriendshipModel.user_id == current_user.id, FriendshipModel.friend_id == friend_id),
                and_(FriendshipModel.user_id == friend_id, FriendshipModel.friend_id == current_user.id)
            ),
            FriendshipModel.status == "accepted"
        )
    )
    friendship = res.scalar_one_or_none()
    if friendship:
        await db.delete(friendship)
        await db.commit()
    return None

@router.get("/friends/list", response_model=list[UserSchema])
@router.get("/friends/list/", response_model=list[UserSchema], include_in_schema=False)
async def get_friends_list(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Возвращает список друзей.
    """
    # Находим все принятые дружбы
    res = await db.execute(
        select(FriendshipModel).where(
            or_(FriendshipModel.user_id == current_user.id, FriendshipModel.friend_id == current_user.id),
            FriendshipModel.status == "accepted"
        )
    )
    friendships = res.scalars().all()
    friend_ids = []
    for f in friendships:
        if f.user_id == current_user.id:
            friend_ids.append(f.friend_id)
        else:
            friend_ids.append(f.user_id)
    
    if not friend_ids:
        return []
        
    res = await db.execute(
        select(UserModel).where(UserModel.id.in_(friend_ids)).options(
            selectinload(UserModel.photos),
            selectinload(UserModel.albums).selectinload(PhotoAlbumModel.photos)
        )
    )
    friends = res.scalars().all()
    return [UserSchema.model_validate(f) for f in friends]

@router.get("/friends/requests", response_model=list[UserSchema])
@router.get("/friends/requests/", response_model=list[UserSchema], include_in_schema=False)
async def get_friend_requests(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Возвращает список входящих заявок в друзья.
    """
    res = await db.execute(
        select(FriendshipModel).where(
            FriendshipModel.friend_id == current_user.id,
            FriendshipModel.status == "pending"
        )
    )
    friendships = res.scalars().all()
    sender_ids = [f.user_id for f in friendships]
    
    if not sender_ids:
        return []
        
    res = await db.execute(
        select(UserModel).where(UserModel.id.in_(sender_ids)).options(
            selectinload(UserModel.photos),
            selectinload(UserModel.albums).selectinload(PhotoAlbumModel.photos)
        )
    )
    senders = res.scalars().all()
    return [UserSchema.model_validate(s) for s in senders]


