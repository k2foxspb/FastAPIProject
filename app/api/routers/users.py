import jwt
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, or_, and_
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import RedirectResponse

from app.core.config import SECRET_KEY, ALGORITHM, MOBILE_DEEPLINK
from app.models.users import (
    User as UserModel, 
    PhotoAlbum as PhotoAlbumModel, 
    UserPhoto as UserPhotoModel,
    Friendship as FriendshipModel,
    UserPhotoComment as UserPhotoCommentModel,
    UserPhotoReaction as UserPhotoReactionModel
)
from app.schemas.users import (
    UserCreate, UserUpdate, User as UserSchema, RefreshTokenRequest, 
    PhotoAlbumCreate, PhotoAlbumUpdate, PhotoAlbum as PhotoAlbumSchema, 
    UserPhotoCreate, UserPhotoUpdate, UserPhoto as UserPhotoSchema,
    FCMTokenUpdate, BulkDeletePhotosRequest, Friendship as FriendshipSchema,
    UserPhotoComment as UserPhotoCommentSchema, UserPhotoCommentCreate
)
from app.schemas.news import News as NewsSchema
from app.schemas.reviews import Review as ReviewSchema
from app.api.dependencies import get_async_db, get_friendship_status, can_view_content
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
from app.utils import storage

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
        query = query.where(or_(
            UserModel.email.ilike(f"%{search}%"),
            UserModel.first_name.ilike(f"%{search}%"),
            UserModel.last_name.ilike(f"%{search}%")
        ))
    
    result = await db.execute(query)
    users = result.scalars().all()

    # Предварительно загружаем все статусы дружбы для текущего пользователя (оптимизация N+1)
    friendships_map = {}
    if current_user:
        res_f = await db.execute(
            select(FriendshipModel).where(
                or_(
                    FriendshipModel.user_id == current_user.id,
                    FriendshipModel.friend_id == current_user.id
                )
            )
        )
        friendships = res_f.scalars().all()
        for f in friendships:
            other_id = f.friend_id if f.user_id == current_user.id else f.user_id
            friendships_map[other_id] = f

    # Скрываем приватный контент для общего списка
    for user in users:
        # Определяем статус дружбы
        friendship_status = None
        user_id = current_user.id if current_user else None

        if current_user:
            if user.id == current_user.id:
                friendship_status = "self"
            else:
                friendship = friendships_map.get(user.id)
                if friendship:
                    if friendship.status == "accepted":
                        friendship_status = "accepted"
                    elif hasattr(friendship, 'deleted_by_id') and friendship.deleted_by_id == current_user.id:
                        # Если текущий пользователь удалил этого друга, 
                        # то для него это либо requested_by_them (если тот все еще считает другом),
                        # либо просто None. Но в текущей схеме deleted_by_id означает "удален из друзей мной".
                        if friendship.user_id == user.id: # Тот был отправителем
                            friendship_status = "requested_by_them"
                        else:
                            friendship_status = None
                    elif friendship.user_id == current_user.id:
                        friendship_status = "requested_by_me"
                    else:
                        friendship_status = "requested_by_them"
                else:
                    friendship_status = None
        
        # Присваиваем для схемы
        user.friendship_status = friendship_status
        
        user.albums = [a for a in user.albums if can_view_content(user.id, user_id, a.privacy, friendship_status)]
        for album in user.albums:
            album.photos = [p for p in album.photos if can_view_content(user.id, user_id, p.privacy, friendship_status)]
        
        user.photos = [p for p in user.photos if can_view_content(user.id, user_id, p.privacy, friendship_status)]

    return [UserSchema.model_validate(u) for u in users]


@router.get("/me")
async def get_me(
    app_version: str | None = None,
    current_user: UserModel = Depends(get_current_user), 
    db: AsyncSession = Depends(get_async_db)
):
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

    # Определяем наличие обновления приложения
    try:
        from sqlalchemy import desc
        from app.models.users import AppVersion as AppVersionModel
        latest_q = await db.execute(select(AppVersionModel).order_by(desc(AppVersionModel.created_at)).limit(1))
        latest = latest_q.scalar_one_or_none()
        latest_info = None
        update_available = False
        if latest:
            latest_info = {
                "id": latest.id,
                "version": latest.version,
                "file_path": latest.file_path,
                "created_at": latest.created_at
            }
            if app_version:
                def parse_ver(v: str) -> list[int]:
                    parts = [p for p in v.split(".") if p.isdigit()]
                    return [int(p) for p in parts]
                try:
                    cur_v = parse_ver(app_version)
                    last_v = parse_ver(latest.version)
                    # Сравнение версий по сегментам
                    for a, b in zip(cur_v + [0]* (len(last_v)-len(cur_v)), last_v + [0]* (len(cur_v)-len(last_v))):
                        if a < b:
                            update_available = True
                            break
                        if a > b:
                            break
                except Exception:
                    # Если версия в неверном формате, не падаем
                    update_available = True
        # Присваиваем временные поля для схемы
        setattr(user, "update_available", update_available)
        setattr(user, "latest_app_version", latest_info)
    except Exception as _e:
        pass
    
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
                privacy="public"
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
            privacy="public"
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
async def verify_email(token: str, redirect: str | None = None, db: AsyncSession = Depends(get_async_db)):
    """
    Подтверждает email пользователя по токену.
    При наличии redirect (или MOBILE_DEEPLINK в конфиге) делает 302 на deeplink:
    - success: <deeplink>?status=success
    - error:   <deeplink>?status=error&reason=<code>
    """
    deeplink_target = redirect or MOBILE_DEEPLINK

    def maybe_redirect(status_str: str, reason: str | None = None):
        if not deeplink_target:
            return None
        url = f"{deeplink_target}?status={status_str}"
        if reason:
            url += f"&reason={reason}"
        return RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        token_type: str = payload.get("type")
        if email is None or token_type != "verification":
            raise ValueError("invalid_token")
    except jwt.ExpiredSignatureError:
        resp = maybe_redirect("error", "token_expired")
        if resp:
            return resp
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Token has expired")
    except jwt.PyJWTError:
        resp = maybe_redirect("error", "invalid_token")
        if resp:
            return resp
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token")
    except ValueError:
        resp = maybe_redirect("error", "invalid_token")
        if resp:
            return resp
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token")

    result = await db.scalars(select(UserModel).where(UserModel.email == email))
    user = result.first()

    if not user:
        resp = maybe_redirect("error", "user_not_found")
        if resp:
            return resp
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    if user.is_active:
        resp = maybe_redirect("success")  # уже подтверждено — всё равно success
        if resp:
            return resp
        return {"message": "Email already verified"}

    user.is_active = True
    await db.commit()

    resp = maybe_redirect("success")
    if resp:
        return resp
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
        privacy=album.privacy
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
        privacy=photo.privacy
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
    """
    result = await db.execute(
        select(PhotoAlbumModel).where(PhotoAlbumModel.id == album_id).options(
            selectinload(PhotoAlbumModel.photos)
        )
    )
    album = result.scalar_one_or_none()
    if not album:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Album not found")
    
    if album.user_id != current_user.id:
        friendship_status = await get_friendship_status(current_user.id, album.user_id, db)
        if not can_view_content(album.user_id, current_user.id, album.privacy, friendship_status):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        
        # Filter photos inside album
        album.photos = [p for p in album.photos if can_view_content(album.user_id, current_user.id, p.privacy, friendship_status)]

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


# Локальные пути остаются для режима local, но основная логика сохранения вынесена в app.utils.storage
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MEDIA_ROOT = os.getenv("MEDIA_ROOT", os.path.join(BASE_DIR, "media"))
USER_MEDIA_ROOT = os.path.join(MEDIA_ROOT, "users")
os.makedirs(USER_MEDIA_ROOT, exist_ok=True)

async def save_user_photo(file: UploadFile) -> tuple[str, str]:
    file_extension = os.path.splitext(file.filename or "")[1] or ".jpg"
    original_name = f"{uuid.uuid4()}{file_extension}"
    content = await file.read()

    # Сохраняем оригинал через абстракцию хранилища
    original_url, _ = storage.save_file(
        category="users",
        filename_hint=original_name,
        fileobj=io.BytesIO(content),
        content_type=file.content_type or "image/jpeg",
        private=False,
    )

    # Пытаемся создать миниатюру
    thumb_name = f"{os.path.splitext(original_name)[0]}_thumb{file_extension}"
    thumb_url = original_url
    try:
        with Image.open(io.BytesIO(content)) as img:
            img.thumbnail((400, 400))
            if file_extension.lower() in [".jpg", ".jpeg"] and img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            thumb_buffer = io.BytesIO()
            # Определяем формат по расширению
            fmt = "JPEG" if file_extension.lower() in [".jpg", ".jpeg"] else None
            img.save(thumb_buffer, format=fmt)
            thumb_buffer.seek(0)
            thumb_url, _ = storage.save_file(
                category="users",
                filename_hint=thumb_name,
                fileobj=thumb_buffer,
                content_type=file.content_type or "image/jpeg",
                private=False,
            )
    except Exception:
        thumb_url = original_url

    return original_url, thumb_url


@router.post("/photos/upload", response_model=UserPhotoSchema, status_code=status.HTTP_201_CREATED)
async def upload_photo(
    file: UploadFile = File(...),
    description: str | None = Form(None),
    album_id: int | None = Form(None),
    privacy: str = Form("public"),
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
        privacy=privacy
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
    privacy: str = Form("public"),
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
                privacy=privacy
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
    Возвращает информацию о конкретной фотографии с лайками и комментариями.
    """
    from sqlalchemy import func
    
    # Подзапросы для лайков и дизлайков
    likes_sub = select(
        func.count(UserPhotoReactionModel.id)
    ).where(UserPhotoReactionModel.photo_id == photo_id, UserPhotoReactionModel.reaction_type == 1).scalar_subquery()

    dislikes_sub = select(
        func.count(UserPhotoReactionModel.id)
    ).where(UserPhotoReactionModel.photo_id == photo_id, UserPhotoReactionModel.reaction_type == -1).scalar_subquery()

    my_reaction_sub = select(
        UserPhotoReactionModel.reaction_type
    ).where(UserPhotoReactionModel.photo_id == photo_id, UserPhotoReactionModel.user_id == current_user.id).scalar_subquery()

    comments_count_sub = select(
        func.count(UserPhotoCommentModel.id)
    ).where(UserPhotoCommentModel.photo_id == photo_id).scalar_subquery()

    result = await db.execute(select(UserPhotoModel).where(UserPhotoModel.id == photo_id))
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")
    
    if photo.user_id != current_user.id:
        friendship_status = await get_friendship_status(current_user.id, photo.user_id, db)
        if not can_view_content(photo.user_id, current_user.id, photo.privacy, friendship_status):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    # Присваиваем дополнительные поля
    photo.likes_count = await db.scalar(likes_sub)
    photo.dislikes_count = await db.scalar(dislikes_sub)
    photo.my_reaction = await db.scalar(my_reaction_sub)
    photo.comments_count = await db.scalar(comments_count_sub)

    return photo


@router.post("/photos/{photo_id}/react")
async def react_to_photo(
    photo_id: int,
    reaction_type: int, # 1 for like, -1 for dislike, 0 to remove
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Поставить лайк или дизлайк фотографии."""
    if reaction_type not in [1, -1, 0]:
        raise HTTPException(status_code=400, detail="Invalid reaction type")

    # Проверяем существование фото
    photo_res = await db.execute(select(UserPhotoModel.id).where(UserPhotoModel.id == photo_id))
    if not photo_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Photo not found")

    # Ищем существующую реакцию
    res = await db.execute(
        select(UserPhotoReactionModel).where(
            UserPhotoReactionModel.photo_id == photo_id,
            UserPhotoReactionModel.user_id == current_user.id
        )
    )
    existing_reaction = res.scalar_one_or_none()

    if reaction_type == 0:
        if existing_reaction:
            await db.delete(existing_reaction)
    else:
        if existing_reaction:
            existing_reaction.reaction_type = reaction_type
        else:
            new_reaction = UserPhotoReactionModel(
                photo_id=photo_id,
                user_id=current_user.id,
                reaction_type=reaction_type
            )
            db.add(new_reaction)
    
    await db.commit()
    return {"status": "ok"}


@router.get("/photos/{photo_id}/comments", response_model=list[UserPhotoCommentSchema])
async def get_photo_comments(
    photo_id: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Получить список комментариев к фотографии."""
    # Проверяем доступ к фото
    photo_res = await db.execute(select(UserPhotoModel).where(UserPhotoModel.id == photo_id))
    photo = photo_res.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    if photo.user_id != current_user.id:
        friendship_status = await get_friendship_status(current_user.id, photo.user_id, db)
        if not can_view_content(photo.user_id, current_user.id, photo.privacy, friendship_status):
            raise HTTPException(status_code=403, detail="Access denied")

    query = select(UserPhotoCommentModel).where(UserPhotoCommentModel.photo_id == photo_id).options(
        selectinload(UserPhotoCommentModel.user)
    ).order_by(UserPhotoCommentModel.created_at.asc())
    
    result = await db.execute(query)
    comments = result.scalars().all()
    
    response = []
    for c in comments:
        comment_dict = UserPhotoCommentSchema.model_validate(c).model_dump()
        comment_dict["first_name"] = c.user.first_name
        comment_dict["last_name"] = c.user.last_name
        comment_dict["avatar_url"] = c.user.avatar_url
        response.append(comment_dict)
        
    return response


@router.post("/photos/{photo_id}/comments", response_model=UserPhotoCommentSchema)
async def add_photo_comment(
    photo_id: int,
    comment_data: UserPhotoCommentCreate,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Добавить комментарий к фотографии."""
    photo_res = await db.execute(select(UserPhotoModel).where(UserPhotoModel.id == photo_id))
    photo = photo_res.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    # Проверка доступа к фото
    if photo.user_id != current_user.id:
        friendship_status = await get_friendship_status(current_user.id, photo.user_id, db)
        if not can_view_content(photo.user_id, current_user.id, photo.privacy, friendship_status):
            raise HTTPException(status_code=403, detail="Access denied")

    new_comment = UserPhotoCommentModel(
        photo_id=photo_id,
        user_id=current_user.id,
        comment=comment_data.comment
    )
    db.add(new_comment)
    await db.commit()
    await db.refresh(new_comment)
    
    res = UserPhotoCommentSchema.model_validate(new_comment).model_dump()
    res["first_name"] = current_user.first_name
    res["last_name"] = current_user.last_name
    res["avatar_url"] = current_user.avatar_url
    return res


@router.delete("/photos/comments/{comment_id}", status_code=204)
async def delete_photo_comment(
    comment_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Удалить свой комментарий или комментарий под своим фото."""
    result = await db.execute(
        select(UserPhotoCommentModel).where(UserPhotoCommentModel.id == comment_id).options(
            selectinload(UserPhotoCommentModel.photo)
        )
    )
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    
    if comment.user_id != current_user.id and comment.photo.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not allowed")
    
    await db.delete(comment)
    await db.commit()
    return None


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
    
    # Удаление файлов
    try:
        # Используем абстракцию хранилища для удаления
        from app.utils import storage
        # В UserPhoto мы не храним ключи отдельно, поэтому пытаемся извлечь ключ из URL
        # или передаем как есть, если это локальный путь
        if db_photo.image_url.startswith("http"):
            # Для S3 извлекаем ключ (category/filename)
            # URL: https://storage.yandexcloud.net/bucket/users/file.jpg -> users/file.jpg
            parts = db_photo.image_url.split("/")
            if len(parts) > 4:
                key = "/".join(parts[4:])
                storage.delete("users", key)
        else:
            storage.delete("users", db_photo.image_url)

        if db_photo.preview_url and db_photo.preview_url != db_photo.image_url:
            if db_photo.preview_url.startswith("http"):
                parts = db_photo.preview_url.split("/")
                if len(parts) > 4:
                    key = "/".join(parts[4:])
                    storage.delete("users", key)
            else:
                storage.delete("users", db_photo.preview_url)
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
    
    # Удаление файлов
    from app.utils import storage
    for path in paths_to_delete:
        try:
            if path.startswith("http"):
                parts = path.split("/")
                if len(parts) > 4:
                    key = "/".join(parts[4:])
                    storage.delete("users", key)
            else:
                storage.delete("users", path)
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
        friendship_status = await get_friendship_status(current_user.id, user.id, db)
        
        user.albums = [a for a in user.albums if can_view_content(user.id, current_user.id, a.privacy, friendship_status)]
        for album in user.albums:
            album.photos = [p for p in album.photos if can_view_content(user.id, current_user.id, p.privacy, friendship_status)]
            
        user.photos = [p for p in user.photos if can_view_content(user.id, current_user.id, p.privacy, friendship_status)]
            
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
        elif hasattr(friendship, 'deleted_by_id') and friendship.deleted_by_id == current_user.id:
            # Текущий пользователь удалил этого друга, но заявка от того осталась
            friendship_status = "requested_by_them"
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
        if hasattr(existing, 'deleted_by_id') and existing.deleted_by_id:
            existing.deleted_by_id = None
            await db.commit()
            await db.refresh(existing)
        return FriendshipSchema.model_validate(existing)
    
    new_friendship_data = {
        "user_id": current_user.id,
        "friend_id": user_id,
        "status": "pending"
    }
    if hasattr(FriendshipModel, 'deleted_by_id'):
        new_friendship_data["deleted_by_id"] = None
        
    new_friendship = FriendshipModel(**new_friendship_data)
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
    if hasattr(friendship, 'deleted_by_id'):
        friendship.deleted_by_id = None
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
    При этом у второго пользователя остается заявка в друзья (статус pending).
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
        # Вместо удаления меняем статус на pending и делаем отправителем того, кого удалили
        # Таким образом, у того, кого удалили, остается заявка в друзья
        friendship.status = "pending"
        friendship.user_id = friend_id
        friendship.friend_id = current_user.id
        if hasattr(friendship, 'deleted_by_id'):
            friendship.deleted_by_id = current_user.id
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
    
    # Фильтруем те, что были удалены текущим пользователем (если поле существует)
    if friendships and hasattr(FriendshipModel, 'deleted_by_id'):
        friendships = [f for f in friendships if f.deleted_by_id != current_user.id]
        
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

@router.get("/me/likes", response_model=list[NewsSchema])
@router.get("/me/likes/", response_model=list[NewsSchema], include_in_schema=False)
async def get_my_liked_news(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Возвращает новости, которые лайкнул текущий пользователь."""
    from app.models.news import News as NewsModel, NewsReaction as NewsReactionModel
    from sqlalchemy import func
    
    likes_sub = select(
        NewsReactionModel.news_id,
        func.count(NewsReactionModel.id).label("count")
    ).where(NewsReactionModel.reaction_type == 1).group_by(NewsReactionModel.news_id).subquery()

    dislikes_sub = select(
        NewsReactionModel.news_id,
        func.count(NewsReactionModel.id).label("count")
    ).where(NewsReactionModel.reaction_type == -1).group_by(NewsReactionModel.news_id).subquery()

    query = select(
        NewsModel,
        func.coalesce(likes_sub.c.count, 0).label("likes_count"),
        func.coalesce(dislikes_sub.c.count, 0).label("dislikes_count"),
        func.literal(1).label("my_reaction")
    ).join(NewsReactionModel, NewsModel.id == NewsReactionModel.news_id)\
     .outerjoin(likes_sub, NewsModel.id == likes_sub.c.news_id)\
     .outerjoin(dislikes_sub, NewsModel.id == dislikes_sub.c.news_id)\
     .where(
         NewsReactionModel.user_id == current_user.id,
         NewsReactionModel.reaction_type == 1,
         NewsModel.moderation_status == "approved",
         NewsModel.is_active == True
     ).options(selectinload(NewsModel.images)).order_by(NewsModel.created_at.desc())

    result = await db.execute(query)
    news_list = []
    for row in result.all():
        news_obj = row[0]
        news_obj.likes_count = row[1]
        news_obj.dislikes_count = row[2]
        news_obj.my_reaction = row[3]
        news_list.append(news_obj)
    return news_list

@router.get("/me/reviews", response_model=list[ReviewSchema])
@router.get("/me/reviews/", response_model=list[ReviewSchema], include_in_schema=False)
async def get_my_reviews(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Возвращает отзывы текущего пользователя."""
    from app.models.reviews import Reviews as ReviewsModel
    
    result = await db.execute(
        select(ReviewsModel).where(ReviewsModel.user_id == current_user.id).order_by(ReviewsModel.comment_date.desc())
    )
    reviews = result.scalars().all()
    
    for r in reviews:
        r.first_name = current_user.first_name
        r.last_name = current_user.last_name
        r.avatar_url = current_user.avatar_url
        
    return reviews


