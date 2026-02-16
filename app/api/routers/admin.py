from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload

from app.models.users import User as UserModel, AdminPermission as AdminPermissionModel
from app.models.categories import Category as CategoryModel
from app.models.products import Product as ProductModel
from app.models.news import News as NewsModel
from app.models.orders import Order as OrderModel
from app.models.reviews import Reviews as ReviewsModel
from app.schemas.users import User as UserSchema, AdminPermissionCreate, AdminPermission as AdminPermissionSchema
from app.schemas.products import Product as ProductSchema
from app.schemas.news import News as NewsSchema
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
        selectinload(UserModel.admin_permissions)
    ))
    return result.scalars().all()

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

# Пример для категорий
@router.get("/categories")
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
@router.get("/products")
async def admin_get_products(
    allowed: bool = Depends(check_admin_permission("products")),
    db: AsyncSession = Depends(get_async_db)
):
    result = await db.execute(select(ProductModel))
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

# --- Модерация ---

@router.get("/moderation/pending")
async def get_pending_moderation(
    db: AsyncSession = Depends(get_async_db),
    admin: UserModel = Depends(get_current_admin)
):
    """Возвращает список товаров и новостей, ожидающих модерации."""
    # Получаем товары
    products_res = await db.execute(
        select(ProductModel).where(ProductModel.moderation_status == "pending")
    )
    products = products_res.scalars().all()
    
    # Получаем новости
    news_res = await db.execute(
        select(NewsModel).where(NewsModel.moderation_status == "pending")
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
