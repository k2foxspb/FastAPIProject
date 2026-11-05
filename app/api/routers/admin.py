from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Form, Query, BackgroundTasks
from typing import List, Optional
import os
import shutil
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, desc, update
from sqlalchemy.orm import selectinload
from app.utils import storage

from app.models.users import User as UserModel, AdminPermission as AdminPermissionModel, PhotoAlbum as PhotoAlbumModel, AppVersion as AppVersionModel, ProfilePost as ProfilePostModel, Friendship as FriendshipModel
from app.models.news import News as NewsModel
from app.models.chat import ChatMessage as ChatMessageModel, FileUploadSession
from app.schemas.users import User as UserSchema, AdminPermissionCreate, AdminPermission as AdminPermissionSchema, AppVersionResponse, AppLogRequest, BanUserRequest
from app.schemas.chat import ChatMessageResponse, DialogResponse, UploadInitRequest, UploadSessionResponse, UploadStatusResponse
from app.api.dependencies import get_async_db
from app.core.auth import get_current_owner, get_current_admin, get_current_user, check_admin_permission
from app.core.roles import can_change_role, can_moderate_user
from datetime import timedelta, timezone as dt_timezone

router = APIRouter(prefix="/admin", tags=["admin"])

# --- Управление правами (Только для Owner) ---

@router.get("/users", response_model=list[UserSchema])
async def get_all_users(
    owner: UserModel = Depends(get_current_owner),
    db: AsyncSession = Depends(get_async_db)
):
    """Возвращает всех пользователей (только для владельца)."""
    result = await db.execute(select(UserModel).options(
        selectinload(UserModel.admin_permissions),
        selectinload(UserModel.photos),
        selectinload(UserModel.albums).selectinload(PhotoAlbumModel.photos)
    ))
    users = result.scalars().all()
    # Возвращаем «плоские» данные без тяжёлых связей, чтобы исключить ленивые догрузки
    return [
        UserSchema.model_validate(u).model_dump()
        for u in users
    ]

@router.get("/users/{user_id}", response_model=UserSchema)
async def get_user_profile_admin(
    user_id: int,
    db: AsyncSession = Depends(get_async_db),
    admin: UserModel = Depends(get_current_admin)
):
    """
    Возвращает полный профиль пользователя по его ID (для администраторов).
    Включает все фотографии и альбомы, даже приватные.
    """
    result = await db.execute(
        select(UserModel).where(UserModel.id == user_id).options(
            selectinload(UserModel.photos),
            selectinload(UserModel.albums).selectinload(PhotoAlbumModel.photos),
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    return UserSchema.model_validate(user)

@router.patch("/users/{user_id}/role")
async def update_user_role(
    user_id: int,
    role: str,
    owner: UserModel = Depends(get_current_owner),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Изменяет роль пользователя. Доступно только владельцу.
    Через этот эндпоинт можно назначить только роли "admin" или "user" -
    роль "owner" через него менять нельзя (передача владения не реализована),
    и менять роль пользователя, у которого уже role=="owner", запрещено.
    """
    allowed_roles = {"admin", "user"}
    if role not in allowed_roles:
        raise HTTPException(status_code=400, detail="Invalid role")

    result = await db.execute(select(UserModel).where(UserModel.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not can_change_role(owner.role, user.role, role):
        raise HTTPException(status_code=400, detail="Cannot change role of the owner")

    user.role = role
    await db.commit()
    return {"message": f"User {user.email} role updated to {role}"}

@router.post("/users/{user_id}/ban")
async def ban_user(
    user_id: int,
    payload: BanUserRequest,
    admin: UserModel = Depends(get_current_admin),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Блокирует пользователя временно (на указанное число часов) или навсегда
    (если duration_hours не передан). Администратор не может заблокировать
    другого администратора или владельца - это может сделать только владелец.
    """
    result = await db.execute(select(UserModel).where(UserModel.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot ban yourself")

    if not can_moderate_user(admin.role, user.role):
        raise HTTPException(status_code=403, detail="Not allowed to ban this user")

    now = datetime.now(dt_timezone.utc)
    user.is_banned = True
    user.ban_reason = payload.reason
    user.banned_until = (now + timedelta(hours=payload.duration_hours)) if payload.duration_hours else None
    user.banned_at = now
    user.banned_by_id = admin.id
    await db.commit()
    await db.refresh(user)
    return UserSchema.model_validate(user)


@router.post("/users/{user_id}/unban")
async def unban_user(
    user_id: int,
    admin: UserModel = Depends(get_current_admin),
    db: AsyncSession = Depends(get_async_db),
):
    """Снимает блокировку с пользователя (восстанавливает доступ)."""
    result = await db.execute(select(UserModel).where(UserModel.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if not can_moderate_user(admin.role, user.role):
        raise HTTPException(status_code=403, detail="Not allowed to unban this user")

    user.is_banned = False
    user.ban_reason = None
    user.banned_until = None
    user.banned_by_id = None
    await db.commit()
    await db.refresh(user)
    return UserSchema.model_validate(user)


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    admin: UserModel = Depends(get_current_admin),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Безвозвратно удаляет пользователя вместе с его данными.
    Администратор не может удалить себя, владельца или другого администратора -
    это ограничено теми же правилами, что и блокировка (см. can_moderate_user).
    """
    result = await db.execute(select(UserModel).where(UserModel.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    if not can_moderate_user(admin.role, user.role):
        raise HTTPException(status_code=403, detail="Not allowed to delete this user")

    # Ссылки без каскадного удаления в БД: обнуляем или очищаем перед удалением пользователя
    await db.execute(
        update(ChatMessageModel)
        .where(ChatMessageModel.forwarded_from_id == user_id)
        .values(forwarded_from_id=None)
    )
    await db.execute(
        update(FriendshipModel)
        .where(FriendshipModel.deleted_by_id == user_id)
        .values(deleted_by_id=None)
    )
    await db.execute(delete(FileUploadSession).where(FileUploadSession.user_id == user_id))
    await db.execute(delete(NewsModel).where(NewsModel.author_id == user_id))

    await db.delete(user)
    await db.commit()
    return {"message": f"User {user.email} deleted"}


@router.post("/permissions", response_model=AdminPermissionSchema)
async def grant_permission(
    permission: AdminPermissionCreate,
    owner: UserModel = Depends(get_current_owner),
    db: AsyncSession = Depends(get_async_db)
):
    """Предоставляет админу доступ к модели."""
    # Проверяем, является ли пользователь админом
    res = await db.execute(select(UserModel).where(UserModel.id == permission.admin_id))
    user = res.scalar_one_or_none()
    if not user or user.role != "admin":
        raise HTTPException(status_code=400, detail="User is not an admin")

    db_perm = AdminPermissionModel(
        admin_id=permission.admin_id,
        model_name=permission.model_name
    )
    db.add(db_perm)
    await db.commit()
    await db.refresh(db_perm)
    return db_perm

@router.delete("/permissions/{permission_id}")
async def revoke_permission(
    permission_id: int,
    owner: UserModel = Depends(get_current_owner),
    db: AsyncSession = Depends(get_async_db)
):
    """Озывает разрешение у админа."""
    await db.execute(delete(AdminPermissionModel).where(AdminPermissionModel.id == permission_id))
    await db.commit()
    return {"message": "Permission revoked"}

# --- CRUD для моделей (Owner или Admin с правами) ---

@router.get("/models")
async def get_manageable_models():
    """Возвращает список моделей, которыми можно управлять."""
    return ["users", "news"]

# --- Управление версиями приложения (Только для Owner) ---

async def notify_users_about_app_version(version_id: int, version: str, file_url: str):
    """
    Рассылает всем активным пользователям уведомление (колокольчик + push) о выходе
    новой версии приложения. По нажатию клиент скачивает и устанавливает APK из file_url.
    """
    from loguru import logger
    from app.database import async_session_maker
    from app.core.notification_service import create_or_group_notification
    from app.core.fcm import absolute_media_url

    try:
        # Фоновая задача: используем собственную сессию (сессия запроса к этому моменту закрыта)
        async with async_session_maker() as db:
            res = await db.execute(
                select(UserModel.id).where(
                    UserModel.is_active == True,
                    UserModel.is_banned == False,
                )
            )
            user_ids = list(res.scalars().all())

            data = {
                "type": "app_update",
                "object_type": "app_version",
                "object_id": version_id,
                "version": version,
                "file_path": absolute_media_url(file_url) or file_url,
            }

            sent = 0
            for user_id in user_ids:
                try:
                    await create_or_group_notification(
                        db,
                        user_id=user_id,
                        notif_type="app_update",
                        title="Доступна новая версия приложения",
                        body=f"Версия {version}. Нажмите, чтобы скачать и установить обновление.",
                        data=dict(data),
                    )
                    sent += 1
                except Exception as e:
                    await db.rollback()
                    logger.error(f"App update: failed to notify user {user_id}: {e}")

            logger.info(f"App update: notified {sent}/{len(user_ids)} users about version {version}")
    except Exception as e:
        logger.error(f"App update: error notifying users about version {version}: {e}")

@router.post("/upload-app", response_model=AppVersionResponse)
async def upload_app_version(
    background_tasks: BackgroundTasks,
    version: str = Form(...),
    file: Optional[UploadFile] = File(None),
    file_path: Optional[str] = Form(None),
    notify_users: bool = Form(True),
    owner: UserModel = Depends(get_current_owner),
    db: AsyncSession = Depends(get_async_db)
):
    """Загружает новую версию мобильного приложения (только владелец)."""
    url = file_path
    
    if file:
        # Имя файла по версии
        file_extension = os.path.splitext(file.filename or "")[1] or ".apk"
        safe_version = version.replace(".", "_")
        filename = f"app_v{safe_version}{file_extension}"

        # Сохраняем через абстракцию хранилища (S3 или локально)
        url, _ = storage.save_file(
            category="app",
            filename_hint=filename,
            fileobj=file.file,  # UploadFile.file — уже файловый объект
            content_type=file.content_type or "application/octet-stream",
            private=False,
        )

    if not url:
        raise HTTPException(status_code=400, detail="File or file_path is required")

    # Создаем запись в БД
    db_version = AppVersionModel(
        version=version,
        file_path=url
    )
    db.add(db_version)
    await db.commit()
    await db.refresh(db_version)

    # Оповещаем всех пользователей о выходе новой версии
    if notify_users:
        background_tasks.add_task(notify_users_about_app_version, db_version.id, db_version.version, db_version.file_path)

    return db_version

@router.post("/upload-app/init", response_model=UploadSessionResponse)
async def init_app_upload(
    req: UploadInitRequest,
    owner: UserModel = Depends(get_current_owner),
    db: AsyncSession = Depends(get_async_db)
):
    """Инициализирует сессию загрузки новой версии приложения (только владелец)."""
    upload_id = str(uuid.uuid4())
    session = FileUploadSession(
        id=upload_id,
        user_id=owner.id,
        filename=req.filename,
        file_size=req.file_size,
        mime_type=req.mime_type,
    )
    db.add(session)
    await db.commit()
    # Возвращаем 1МБ как чанк сайз по умолчанию, как в чате
    return {"upload_id": upload_id, "offset": 0, "chunk_size": 1024 * 1024}

@router.post("/upload-app/chunk/{upload_id}")
async def upload_app_chunk(
    upload_id: str,
    token: Optional[str] = Form(None),
    offset: Optional[int] = Form(None),
    q_offset: Optional[int] = Query(None),
    q_token: Optional[str] = Query(None),
    chunk: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_async_db)
):
    """Загружает чанк файла приложения (только владелец)."""
    # Поддержка токена и смещения из разных источников для надежности
    actual_token = token or q_token
    actual_offset = offset if offset is not None else q_offset
    
    if actual_token is None:
        raise HTTPException(status_code=401, detail="Missing token")
    
    # Очистка токена
    actual_token = actual_token.strip().strip('"').strip("'")

    if actual_offset is None:
        raise HTTPException(status_code=422, detail="Missing offset")
        
    if chunk is None:
        return {"status": "error", "message": "Missing chunk"}

    # Проверка пользователя по токену
    from app.api.routers.chat import get_user_from_token
    user = await get_user_from_token(actual_token, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid token")
        
    # Проверка, что это владелец
    if user.role != "owner":
        raise HTTPException(status_code=403, detail="Only owner can upload app versions")

    user_id = user.id

    res = await db.execute(select(FileUploadSession).where(FileUploadSession.id == upload_id))
    session = res.scalar_one_or_none()
    
    if not session or session.user_id != user_id:
        raise HTTPException(status_code=404, detail="Upload session not found")
    
    if session.is_completed:
        raise HTTPException(status_code=400, detail="Upload already completed")
        
    if actual_offset != session.offset:
        return {"status": "error", "message": "Offset mismatch", "current_offset": session.offset}

    # Путь к временному файлу
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    temp_dir = os.path.join(root_dir, "media", "temp")
    os.makedirs(temp_dir, exist_ok=True)
    file_path = os.path.join(temp_dir, f"{upload_id}_{session.filename}")
    
    # Записываем чанк
    mode = "ab" if actual_offset > 0 else "wb"
    with open(file_path, mode) as f:
        content = await chunk.read()
        f.write(content)
        session.offset += len(content)
    
    if session.offset >= session.file_size:
        session.is_completed = True
        session.offset = session.file_size
        # Загружаем собранный файл в постоянное хранилище
        with open(file_path, "rb") as f_in:
            url, _ = storage.save_file(
                category="app",
                filename_hint=session.filename,
                fileobj=f_in,
                content_type=session.mime_type or "application/octet-stream",
                private=False,
            )
        try:
            os.remove(file_path)
        except Exception:
            pass
            
        await db.commit()
        return {
            "status": "completed",
            "file_path": url
        }
    
    await db.commit()
    return {"status": "ok", "offset": session.offset}

@router.get("/upload-app/status/{upload_id}", response_model=UploadStatusResponse)
async def get_app_upload_status(
    upload_id: str,
    owner: UserModel = Depends(get_current_owner),
    db: AsyncSession = Depends(get_async_db)
):
    """Возвращает статус загрузки файла приложения."""
    res = await db.execute(select(FileUploadSession).where(FileUploadSession.id == upload_id))
    session = res.scalar_one_or_none()
    
    if not session or session.user_id != owner.id:
        raise HTTPException(status_code=404, detail="Upload session not found")
        
    return {
        "upload_id": session.id,
        "offset": session.offset,
        "is_completed": bool(session.is_completed)
    }

@router.get("/app-versions", response_model=list[AppVersionResponse])
async def get_app_versions(
    owner: UserModel = Depends(get_current_owner),
    db: AsyncSession = Depends(get_async_db)
):
    """Возвращает историю версий приложения."""
    result = await db.execute(select(AppVersionModel).order_by(desc(AppVersionModel.created_at)))
    return result.scalars().all()

# --- Чаты ---

@router.get("/chats", response_model=list[dict])
async def admin_get_all_dialogs(
    allowed: bool = Depends(check_admin_permission("chats")),
    db: AsyncSession = Depends(get_async_db)
):
    """Возвращает все уникальные диалоги между пользователями."""
    # Получаем последние сообщения для каждой пары
    # Используем подзапрос для производительности, но для SQLite/простоты можно и так:
    result = await db.execute(
        select(ChatMessageModel)
        .options(
            selectinload(ChatMessageModel.sender).selectinload(UserModel.photos),
            selectinload(ChatMessageModel.sender).selectinload(UserModel.albums).selectinload(PhotoAlbumModel.photos),
            selectinload(ChatMessageModel.receiver).selectinload(UserModel.photos),
            selectinload(ChatMessageModel.receiver).selectinload(UserModel.albums).selectinload(PhotoAlbumModel.photos)
        )
        .order_by(ChatMessageModel.timestamp.desc())
    )
    messages = result.scalars().all()
    
    dialogs = {}
    for msg in messages:
        pair = tuple(sorted((msg.sender_id, msg.receiver_id)))
        if pair not in dialogs:
            u1 = UserSchema.model_validate(msg.sender)
            u2 = UserSchema.model_validate(msg.receiver)
            
            dialogs[pair] = {
                "user1": u1.model_dump(exclude={"photos", "albums", "admin_permissions"}),
                "user2": u2.model_dump(exclude={"photos", "albums", "admin_permissions"}),
                "last_message": msg.message or "[Файл]",
                "last_message_time": msg.timestamp,
                "pair": pair
            }
    
    return list(dialogs.values())

@router.get("/chats/{u1_id}/{u2_id}", response_model=list[ChatMessageResponse])
async def admin_get_chat_history(
    u1_id: int,
    u2_id: int,
    limit: int = Query(default=15, ge=1, le=100),
    skip: int = Query(default=0, ge=0),
    allowed: bool = Depends(check_admin_permission("chats")),
    db: AsyncSession = Depends(get_async_db)
):
    """Возвращает историю переписки между двумя пользователями с пагинацией."""
    result = await db.execute(
        select(ChatMessageModel)
        .where(
            ((ChatMessageModel.sender_id == u1_id) & (ChatMessageModel.receiver_id == u2_id)) |
            ((ChatMessageModel.sender_id == u2_id) & (ChatMessageModel.receiver_id == u1_id))
        )
        .order_by(ChatMessageModel.timestamp.desc())
        .limit(limit)
        .offset(skip)
    )
    messages = result.scalars().all()
    return list(reversed(messages))

@router.delete("/chats/messages/{message_id}")
async def admin_delete_message(
    message_id: int,
    allowed: bool = Depends(check_admin_permission("chats")),
    db: AsyncSession = Depends(get_async_db)
):
    """Удаляет сообщение (полностью из базы)."""
    await db.execute(delete(ChatMessageModel).where(ChatMessageModel.id == message_id))
    await db.commit()
    return {"message": "Message deleted"}

@router.delete("/chats/messages")
async def admin_bulk_delete_messages(
    message_ids: list[int],
    allowed: bool = Depends(check_admin_permission("chats")),
    db: AsyncSession = Depends(get_async_db)
):
    """Удаляет несколько сообщений (полностью из базы)."""
    await db.execute(delete(ChatMessageModel).where(ChatMessageModel.id.in_(message_ids)))
    await db.commit()
    return {"message": f"Deleted {len(message_ids)} messages"}

# --- Модерация ---

@router.get("/moderation/pending")
async def get_pending_moderation(
    db: AsyncSession = Depends(get_async_db),
    admin: UserModel = Depends(get_current_admin)
):
    """Возвращает список новостей и публикаций пользователей, ожидающих модерации."""
    news_res = await db.execute(
        select(NewsModel).options(selectinload(NewsModel.images)).where(NewsModel.moderation_status == "pending")
    )
    news = news_res.scalars().all()

    posts_res = await db.execute(
        select(ProfilePostModel)
        .options(selectinload(ProfilePostModel.user))
        .where(
            ProfilePostModel.moderation_status == "pending",
            ProfilePostModel.post_type == "post",
            ProfilePostModel.is_active == True,
        )
    )
    posts = posts_res.scalars().all()

    return {
        "news": news,
        "posts": [
            {
                "id": p.id,
                "content": p.content,
                "media_url": p.media_url,
                "media_type": p.media_type,
                "created_at": p.created_at,
                "user_id": p.user_id,
                "author_name": (f"{p.user.first_name or ''} {p.user.last_name or ''}".strip() or p.user.email) if p.user else None,
            }
            for p in posts
        ],
    }

@router.post("/moderation/approve/{model}/{id}")
async def approve_object(
    model: str,
    id: int,
    db: AsyncSession = Depends(get_async_db),
    admin: UserModel = Depends(get_current_admin)
):
    """Одобряет объект."""
    if model == "news":
        stmt = select(NewsModel).where(NewsModel.id == id)
    elif model == "post":
        stmt = select(ProfilePostModel).where(ProfilePostModel.id == id)
    else:
        raise HTTPException(status_code=400, detail="Invalid model")

    res = await db.execute(stmt)
    obj = res.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    obj.moderation_status = "approved"
    await db.commit()
    return {"message": f"{model} {id} approved"}

@router.post("/moderation/reject/{model}/{id}")
async def reject_object(
    model: str,
    id: int,
    db: AsyncSession = Depends(get_async_db),
    admin: UserModel = Depends(get_current_admin)
):
    """Отклоняет объект."""
    if model == "news":
        stmt = select(NewsModel).where(NewsModel.id == id)
    elif model == "post":
        stmt = select(ProfilePostModel).where(ProfilePostModel.id == id)
    else:
        raise HTTPException(status_code=400, detail="Invalid model")

    res = await db.execute(stmt)
    obj = res.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    obj.moderation_status = "rejected"
    if model == "news":
        obj.title = "Пост отклонен"
        obj.content = "запрет модераторова"
        # Также очищаем картинки
        obj.image_url = None
        # Удаляем связанные изображения из БД
        from app.models.news import NewsImage as NewsImageModel
        await db.execute(delete(NewsImageModel).where(NewsImageModel.news_id == id))
    elif model == "post":
        # Публикацию не удаляем безвозвратно - скрываем из ленты/профиля,
        # чтобы автор мог видеть историю, но другие пользователи её не видели.
        obj.is_hidden = True
    await db.commit()
    return {"message": f"{model} {id} rejected"}

@router.get("/logs")
async def get_logs(
    limit: int = Query(1000, description="Количество последних строк"),
    owner: UserModel = Depends(get_current_owner)
):
    """Возвращает последние строки логов (только для владельца)."""
    log_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "info.log")
    
    # Пытаемся найти файл в текущей директории, если по абсолютному пути не найден
    if not os.path.exists(log_file):
        log_file = "info.log"

    if not os.path.exists(log_file):
        return {"logs": [f"Log file not found at {log_file}"]}
    
    try:
        with open(log_file, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
            last_lines = [line.strip() for line in lines[-limit:]]
            return {"logs": last_lines}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading logs: {str(e)}")

@router.post("/app-logs")
async def add_app_log(
    log: AppLogRequest,
    user: UserModel = Depends(get_current_user)
):
    """Добавляет лог от мобильного приложения."""
    # Пытаемся найти файл в корне проекта
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    log_file = os.path.join(root_dir, "app_logs.log")
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entry = f"[{timestamp}] [{log.level.upper()}] {log.message}"
    if log.device_info:
        log_entry += f" | Device: {log.device_info}"
    
    try:
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(log_entry + "\n")
        return {"message": "Log added"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error writing app log: {str(e)}")

@router.get("/app-logs")
async def get_app_logs(
    limit: int = Query(1000, description="Количество последних строк"),
    owner: UserModel = Depends(get_current_owner)
):
    """Возвращает последние строки логов приложения."""
    # Пытаемся найти файл в корне проекта
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    log_file = os.path.join(root_dir, "app_logs.log")
    
    # Резервный поиск в текущей директории
    if not os.path.exists(log_file):
        log_file = "app_logs.log"
    
    if not os.path.exists(log_file):
        return {"logs": ["App log file not yet created"]}
    
    try:
        with open(log_file, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
            last_lines = [line.strip() for line in lines[-limit:]]
            return {"logs": last_lines}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading app logs: {str(e)}")
