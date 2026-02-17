from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload

from app.models.users import User as UserModel, AdminPermission as AdminPermissionModel, PhotoAlbum as PhotoAlbumModel
from app.models.categories import Category as CategoryModel
from app.models.products import Product as ProductModel
from app.models.news import News as NewsModel
from app.models.orders import Order as OrderModel, OrderItem as OrderItemModel
from app.models.reviews import Reviews as ReviewsModel
from app.models.chat import ChatMessage as ChatMessageModel
from app.schemas.users import User as UserSchema, AdminPermissionCreate, AdminPermission as AdminPermissionSchema
from app.schemas.products import Product as ProductSchema
from app.schemas.news import News as NewsSchema
from app.schemas.chat import ChatMessageResponse, DialogResponse
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
    # Explicitly validate to catch errors early and ensure relationships are handled
    return [UserSchema.model_validate(u) for u in users]

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
    return ["categories", "products", "orders", "reviews", "users", "chats"]

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
    await db.commit()
    return {"message": f"{model} {id} rejected"}
