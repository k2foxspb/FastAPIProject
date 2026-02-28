from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Form, Query
from typing import List, Optional
import os
import shutil
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, desc
from sqlalchemy.orm import selectinload
from app.utils import storage

from app.models.users import User as UserModel, AdminPermission as AdminPermissionModel, PhotoAlbum as PhotoAlbumModel, AppVersion as AppVersionModel
from app.models.categories import Category as CategoryModel
from app.models.products import Product as ProductModel
from app.models.news import News as NewsModel
from app.models.orders import Order as OrderModel, OrderItem as OrderItemModel
from app.models.reviews import Reviews as ReviewsModel
from app.models.chat import ChatMessage as ChatMessageModel, FileUploadSession
from app.schemas.users import User as UserSchema, AdminPermissionCreate, AdminPermission as AdminPermissionSchema, AppVersionResponse
from app.schemas.products import Product as ProductSchema
from app.schemas.news import News as NewsSchema
from app.schemas.chat import ChatMessageResponse, DialogResponse, UploadInitRequest, UploadSessionResponse, UploadStatusResponse
from app.schemas.orders import Order as OrderSchema
from app.api.dependencies import get_async_db
from app.core.auth import get_current_owner, get_current_admin, check_admin_permission

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
            selectinload(UserModel.albums).selectinload(PhotoAlbumModel.photos)
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
    db: AsyncSession = Depends(get_async_db)
):
    """Изменяет роль пользователя. Только владелец может назначать админов или передавать владение."""
    if role not in ["buyer", "seller", "admin", "owner"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    result = await db.execute(select(UserModel).where(UserModel.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if role == "owner":
        # Проверяем, есть ли уже владелец (кроме целевого пользователя, если он уже владелец)
        result_owner = await db.execute(select(UserModel).where(UserModel.role == "owner", UserModel.id != user_id))
        if result_owner.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Owner already exists. There can be only one owner.")
    
    if role == "owner" and user.id != owner.id:
        # Передача владения: текущий владелец становится админом
        owner.role = "admin"
    
    user.role = role
    await db.commit()
    return {"message": f"User {user.email} role updated to {role}"}

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
    return ["categories", "products", "orders", "reviews", "users"]

# --- Управление версиями приложения (Только для Owner) ---

@router.post("/upload-app", response_model=AppVersionResponse)
async def upload_app_version(
    version: str = Form(...),
    file: Optional[UploadFile] = File(None),
    file_path: Optional[str] = Form(None),
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
    user_id = await get_user_from_token(actual_token, db)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token")
        
    # Проверка, что это владелец
    user_res = await db.execute(select(UserModel).where(UserModel.id == user_id))
    user = user_res.scalar_one_or_none()
    if not user or user.role != "owner":
        raise HTTPException(status_code=403, detail="Only owner can upload app versions")

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
    allowed: bool = Depends(check_admin_permission("chats")),
    db: AsyncSession = Depends(get_async_db)
):
    """Возвращает историю переписки между двумя пользователями."""
    result = await db.execute(
        select(ChatMessageModel)
        .where(
            ((ChatMessageModel.sender_id == u1_id) & (ChatMessageModel.receiver_id == u2_id)) |
            ((ChatMessageModel.sender_id == u2_id) & (ChatMessageModel.receiver_id == u1_id))
        )
        .order_by(ChatMessageModel.timestamp.asc())
    )
    return result.scalars().all()

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

# Пример для категорий
from app.schemas.categories import Category as CategorySchema
@router.get("/categories", response_model=list[CategorySchema])
async def admin_get_categories(
    allowed: bool = Depends(check_admin_permission("categories")),
    db: AsyncSession = Depends(get_async_db)
):
    result = await db.execute(select(CategoryModel))
    return result.scalars().all()

@router.delete("/categories/{cat_id}")
async def admin_delete_category(
    cat_id: int,
    allowed: bool = Depends(check_admin_permission("categories")),
    db: AsyncSession = Depends(get_async_db)
):
    await db.execute(delete(CategoryModel).where(CategoryModel.id == cat_id))
    await db.commit()
    return {"message": "Category deleted"}

# Пример для товаров
@router.get("/products", response_model=list[ProductSchema])
async def admin_get_products(
    allowed: bool = Depends(check_admin_permission("products")),
    db: AsyncSession = Depends(get_async_db)
):
    result = await db.execute(select(ProductModel).options(selectinload(ProductModel.images)))
    return result.scalars().all()

@router.delete("/products/{prod_id}")
async def admin_delete_product(
    prod_id: int,
    allowed: bool = Depends(check_admin_permission("products")),
    db: AsyncSession = Depends(get_async_db)
):
    await db.execute(delete(ProductModel).where(ProductModel.id == prod_id))
    await db.commit()
    return {"message": "Product deleted"}

# --- Заказы ---

@router.get("/orders", response_model=list[OrderSchema])
async def admin_get_orders(
    allowed: bool = Depends(check_admin_permission("orders")),
    db: AsyncSession = Depends(get_async_db)
):
    result = await db.execute(
        select(OrderModel).options(
            selectinload(OrderModel.items).selectinload(OrderItemModel.product).selectinload(ProductModel.images)
        )
    )
    return result.scalars().all()

@router.delete("/orders/{order_id}")
async def admin_delete_order(
    order_id: int,
    allowed: bool = Depends(check_admin_permission("orders")),
    db: AsyncSession = Depends(get_async_db)
):
    await db.execute(delete(OrderModel).where(OrderModel.id == order_id))
    await db.commit()
    return {"message": "Order deleted"}

# --- Отзывы ---
from app.schemas.reviews import Review as ReviewSchemaFull
@router.get("/reviews", response_model=list[ReviewSchemaFull])
async def admin_get_reviews(
    allowed: bool = Depends(check_admin_permission("reviews")),
    db: AsyncSession = Depends(get_async_db)
):
    result = await db.execute(select(ReviewsModel).options(selectinload(ReviewsModel.user)))
    reviews = result.scalars().all()
    for r in reviews:
        r.first_name = r.user.first_name
        r.last_name = r.user.last_name
        r.avatar_url = r.user.avatar_url
    return reviews

@router.delete("/reviews/{review_id}")
async def admin_delete_review(
    review_id: int,
    allowed: bool = Depends(check_admin_permission("reviews")),
    db: AsyncSession = Depends(get_async_db)
):
    await db.execute(delete(ReviewsModel).where(ReviewsModel.id == review_id))
    await db.commit()
    return {"message": "Review deleted"}

# --- Модерация ---

@router.get("/moderation/pending")
async def get_pending_moderation(
    db: AsyncSession = Depends(get_async_db),
    admin: UserModel = Depends(get_current_admin)
):
    """Возвращает список товаров и новостей, ожидающих модерации."""
    # Получаем товары
    products_res = await db.execute(
        select(ProductModel).options(selectinload(ProductModel.images)).where(ProductModel.moderation_status == "pending")
    )
    products = products_res.scalars().all()
    
    # Получаем новости
    news_res = await db.execute(
        select(NewsModel).options(selectinload(NewsModel.images)).where(NewsModel.moderation_status == "pending")
    )
    news = news_res.scalars().all()
    
    return {
        "products": products,
        "news": news
    }

@router.post("/moderation/approve/{model}/{id}")
async def approve_object(
    model: str,
    id: int,
    db: AsyncSession = Depends(get_async_db),
    admin: UserModel = Depends(get_current_admin)
):
    """Одобряет объект."""
    if model == "product":
        stmt = select(ProductModel).where(ProductModel.id == id)
    elif model == "news":
        stmt = select(NewsModel).where(NewsModel.id == id)
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
    if model == "product":
        stmt = select(ProductModel).where(ProductModel.id == id)
    elif model == "news":
        stmt = select(NewsModel).where(NewsModel.id == id)
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
    await db.commit()
    return {"message": f"{model} {id} rejected"}

@router.get("/logs")
async def get_logs(
    limit: int = Query(1000, description="Количество последних строк"),
    owner: UserModel = Depends(get_current_owner)
):
    """Возвращает последние строки логов (только для владельца)."""
    log_file = "info.log"
    
    # Пытаемся найти файл в корне проекта
    if not os.path.exists(log_file):
        root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        log_file = os.path.join(root_dir, "info.log")

    if not os.path.exists(log_file):
        return {"logs": [f"Log file not found at {log_file}"]}
    
    try:
        with open(log_file, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
            last_lines = [line.strip() for line in lines[-limit:]]
            return {"logs": last_lines}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading logs: {str(e)}")
