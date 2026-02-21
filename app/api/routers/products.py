import uuid
import io
from pathlib import Path
from PIL import Image
from app.utils import storage

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import select, update, and_, func, desc
from sqlalchemy.orm import selectinload, joinedload
from starlette.status import HTTP_201_CREATED, HTTP_404_NOT_FOUND, HTTP_200_OK, HTTP_400_BAD_REQUEST, HTTP_403_FORBIDDEN

from app.core.auth import get_current_seller, get_current_user_optional
from app.api.dependencies import get_async_db
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from app.models.products import Product as ProductModel, ProductImage as ProductImageModel
from app.models.categories import Category as CategoryModel
from app.models.users import User as UserModel
from app.schemas.products import Product as ProductShema, ProductCreate, ProductList
from app.models.reviews import Reviews as ReviewsModel
from app.schemas.reviews import Review

# Создаём маршрутизатор для товаров
router = APIRouter(
    prefix="/products",
    tags=["products"],
)

BASE_DIR = Path(__file__).resolve().parent.parent.parent
MEDIA_ROOT = BASE_DIR / "media" / "products"
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_SIZE = 2 * 1024 * 1024  # 2 097 152 байт


async def save_product_image(file: UploadFile) -> tuple[str, str]:
    """
    Сохраняет изображение товара (через абстракцию хранилища), генерирует миниатюру и возвращает URL.
    """
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(HTTP_400_BAD_REQUEST, "Only JPG, PNG or WebP images are allowed")

    content = await file.read()
    if len(content) > MAX_IMAGE_SIZE:
        raise HTTPException(HTTP_400_BAD_REQUEST, "Image is too large")

    extension = Path(file.filename or "").suffix.lower() or ".jpg"
    base_name = str(uuid.uuid4())

    # Save original via storage
    original_url, _ = storage.save_file(
        category="products",
        filename_hint=f"{base_name}{extension}",
        fileobj=io.BytesIO(content),
        content_type=file.content_type or "image/jpeg",
        private=False,
    )

    # Generate thumbnail
    thumb_url = original_url
    try:
        with Image.open(io.BytesIO(content)) as img:
            img.thumbnail((200, 200))
            thumb_buffer = io.BytesIO()
            fmt = "JPEG" if extension in [".jpg", ".jpeg"] else None
            img.save(thumb_buffer, format=fmt)
            thumb_buffer.seek(0)
            thumb_url, _ = storage.save_file(
                category="products",
                filename_hint=f"{base_name}_thumb{extension}",
                fileobj=thumb_buffer,
                content_type=file.content_type or "image/jpeg",
                private=False,
            )
    except Exception:
        thumb_url = original_url

    return original_url, thumb_url


def remove_product_image(url: str | None, thumb_url: str | None = None) -> None:
    """
    Удаляет файл(ы) изображения, поддерживает как локальные пути, так и S3/YC URL.
    """
    from app.utils import storage as _storage

    def _delete_by_path_or_url(p: str):
        if p.startswith("http"):
            parts = p.split("/")
            if len(parts) > 4:
                key = "/".join(parts[4:])  # products/...
                _storage.delete("products", key)
        else:
            _storage.delete("products", p)

    for image_url in [url, thumb_url]:
        if not image_url:
            continue
        try:
            _delete_by_path_or_url(image_url)
        except Exception as e:
            print(f"remove_product_image: failed to delete {image_url}: {e}")


@router.get("", response_model=ProductList)
@router.get("/", response_model=ProductList, include_in_schema=False)
async def get_all_products(
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=100),
        category_id: int | None = Query(None, description="ID категории для фильтрации"),
        search: str | None = Query(None, min_length=1, description="Поиск по названию/описанию"),
        min_price: float | None = Query(None, ge=0, description="Минимальная цена товара"),
        max_price: float | None = Query(None, ge=0, description="Максимальная цена товара"),
        in_stock: bool | None = Query(None, description="true — только товары в наличии, false — только без остатка"),
        seller_id: int | None = Query(None, description="ID продавца для фильтрации"),
        db: AsyncSession = Depends(get_async_db),
):
    if min_price is not None and max_price is not None and min_price > max_price:
        raise HTTPException(
            status_code=HTTP_400_BAD_REQUEST,
            detail="min_price не может быть больше max_price",
        )

    filters = [ProductModel.is_active.is_(True)]

    if seller_id is None:
        filters.append(ProductModel.moderation_status == "approved")
    
    if category_id is not None:
        filters.append(ProductModel.category_id == category_id)
    if min_price is not None:
        filters.append(ProductModel.price >= min_price)
    if max_price is not None:
        filters.append(ProductModel.price <= max_price)
    if in_stock is not None:
        filters.append(ProductModel.stock > 0 if in_stock else ProductModel.stock == 0)
    if seller_id is not None:
        filters.append(ProductModel.seller_id == seller_id)

    # Базовый запрос total
    total_stmt = select(func.count()).select_from(ProductModel).where(*filters)

    rank_col = None
    if search:
        search_value = search.strip()
        if search_value:
            ts_query = func.websearch_to_tsquery('english', search_value)
            filters.append(ProductModel.tsv.op('@@')(ts_query))
            rank_col = func.ts_rank_cd(ProductModel.tsv, ts_query).label("rank")
            # total с учётом полнотекстового фильтра
            total_stmt = select(func.count()).select_from(ProductModel).where(*filters)

    total = await db.scalar(total_stmt) or 0

    # Основной запрос (если есть поиск — добавим ранг в выборку и сортировку)
    if rank_col is not None:
        products_stmt = (
            select(ProductModel, rank_col)
            .options(selectinload(ProductModel.images))
            .where(*filters)
            .order_by(desc(rank_col), ProductModel.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await db.execute(products_stmt)
        rows = result.all()
        items = [row[0] for row in rows]  # сами объекты
    else:
        products_stmt = (
            select(ProductModel)
            .options(selectinload(ProductModel.images))
            .where(*filters)
            .order_by(desc(ProductModel.id))
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = (await db.scalars(products_stmt)).all()

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/", response_model=ProductShema, status_code=HTTP_201_CREATED)
async def create_product(
        product: ProductCreate = Depends(ProductCreate.as_form),
        images: list[UploadFile] = File(None),
        db: AsyncSession = Depends(get_async_db),
        current_user: UserModel = Depends(get_current_seller)
):
    """
    Создаёт новый товар, привязанный к текущему продавцу (только для 'seller').
    Поддерживает загрузку нескольких фотографий.
    """

    category_result = await db.scalars(
        select(CategoryModel).where(CategoryModel.id == product.category_id, CategoryModel.is_active == True)
    )
    if not category_result.first():
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST,
                            detail="Category not found or inactive")

    # Сохранение первого изображения как основного (thumbnail) для совместимости
    main_image_url, main_thumbnail_url = (None, None)
    
    # Создание товара
    db_product = ProductModel(
        **product.model_dump(),
        seller_id=current_user.id,
        moderation_status="approved" if current_user.role in ["admin", "owner"] else "pending"
    )

    if images:
        for idx, img in enumerate(images):
            image_url, thumbnail_url = await save_product_image(img)
            if idx == 0:
                main_image_url, main_thumbnail_url = image_url, thumbnail_url
            
            db_product.images.append(ProductImageModel(
                image_url=image_url,
                thumbnail_url=thumbnail_url
            ))

    db_product.image_url = main_image_url
    db_product.thumbnail_url = main_thumbnail_url

    db.add(db_product)
    await db.commit()
    await db.refresh(db_product)
    # Перезагружаем со связями
    stmt = select(ProductModel).options(selectinload(ProductModel.images)).where(ProductModel.id == db_product.id)
    return await db.scalar(stmt)


@router.get("/category/{category_id}", response_model=list[ProductShema])
async def get_products_by_category(category_id: int, db: AsyncSession = Depends(get_async_db)):
    """
    Возвращает список товаров в указанной категории по её ID.
    """
    stmt = select(ProductModel).where(ProductModel.category_id == category_id)
    return await db.scalars(stmt)


@router.get("/{product_id}", response_model=ProductShema, status_code=HTTP_200_OK)
async def get_product(product_id: int, db: AsyncSession = Depends(get_async_db)):
    """
    Возвращает детальную информацию о товаре по его ID.
    """
    stmt = (
        select(ProductModel)
        .options(selectinload(ProductModel.images))
        .where(and_(ProductModel.is_active == True, ProductModel.id == product_id))
    )
    product = await db.scalar(stmt)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    
    return product


@router.put("/{product_id}", response_model=ProductShema)
async def update_product(
        product_id: int,
        product: ProductCreate = Depends(ProductCreate.as_form),
        images: list[UploadFile] = File(None),
        db: AsyncSession = Depends(get_async_db),
        current_user: UserModel = Depends(get_current_seller)
):
    """
    Обновляет товар, если он принадлежит текущему продавцу (только для 'seller').
    """
    result = await db.execute(
        select(ProductModel)
        .options(selectinload(ProductModel.images))
        .where(ProductModel.id == product_id)
    )
    db_product = result.scalar_one_or_none()
    if not db_product:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Product not found")
    if db_product.seller_id != current_user.id:
        raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail="You can only update your own products")
    category_result = await db.scalars(
        select(CategoryModel).where(CategoryModel.id == product.category_id, CategoryModel.is_active == True)
    )
    if not category_result.first():
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="Category not found or inactive")
    
    # Обновляем основные поля
    for key, value in product.model_dump().items():
        setattr(db_product, key, value)

    if images:
        # При загрузке новых фото в этом упрощенном варианте мы добавляем их к существующим
        # Или можно было бы очищать старые. Давайте добавлять.
        for img in images:
            image_url, thumbnail_url = await save_product_image(img)
            db_product.images.append(ProductImageModel(
                image_url=image_url,
                thumbnail_url=thumbnail_url
            ))
        
        # Обновляем основное фото, если его не было
        if not db_product.image_url and db_product.images:
            db_product.image_url = db_product.images[0].image_url
            db_product.thumbnail_url = db_product.images[0].thumbnail_url

    if current_user.role not in ["admin", "owner"]:
        db_product.moderation_status = "pending"
    else:
        db_product.moderation_status = "approved"

    await db.commit()
    await db.refresh(db_product)
    
    # Перезагружаем со связями
    stmt = select(ProductModel).options(selectinload(ProductModel.images)).where(ProductModel.id == db_product.id)
    return await db.scalar(stmt)

@router.delete("/{product_id}/images/{image_id}")
async def delete_product_image(
    product_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_seller)
):
    """Удаляет конкретное изображение товара."""
    res = await db.execute(select(ProductImageModel).where(ProductImageModel.id == image_id, ProductImageModel.product_id == product_id))
    img = res.scalar_one_or_none()
    if not img:
        raise HTTPException(404, "Image not found")
    
    # Проверка прав (только владелец товара или админ)
    res_prod = await db.execute(select(ProductModel).where(ProductModel.id == product_id))
    product = res_prod.scalar_one_or_none()
    if not product or (product.seller_id != current_user.id and current_user.role not in ['admin', 'owner']):
        raise HTTPException(403, "Not allowed")

    remove_product_image(img.image_url, img.thumbnail_url)
    await db.delete(img)
    
    # Если это было основное фото, обновляем его у товара
    if product.image_url == img.image_url:
        # Берем следующее доступное фото
        res_next = await db.execute(select(ProductImageModel).where(ProductImageModel.product_id == product_id, ProductImageModel.id != image_id))
        next_img = res_next.scalar_one_or_none()
        if next_img:
            product.image_url = next_img.image_url
            product.thumbnail_url = next_img.thumbnail_url
        else:
            product.image_url = None
            product.thumbnail_url = None

    await db.commit()
    return {"message": "Image deleted"}


@router.delete("/{product_id}", response_model=ProductShema)
async def delete_product(
        product_id: int,
        db: AsyncSession = Depends(get_async_db),
        current_user: UserModel = Depends(get_current_seller)
):
    """
    Выполняет мягкое удаление товара, если он принадлежит текущему продавцу (только для 'seller').
    """
    result = await db.scalars(
        select(ProductModel).where(ProductModel.id == product_id, ProductModel.is_active == True)
    )
    product = result.first()
    if not product:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Product not found or inactive")
    if product.seller_id != current_user.id:
        raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail="You can only delete your own products")
    await db.execute(
        update(ProductModel).where(ProductModel.id == product_id).values(is_active=False)
    )
    remove_product_image(product.image_url, product.thumbnail_url)

    await db.commit()
    await db.refresh(product)  # Для возврата is_active = False
    return product


@router.get('/{product_id}/review', response_model=list[Review])
async def get_reviews(
    product_id: int, 
    db: AsyncSession = Depends(get_async_db),
    current_user: Optional[UserModel] = Depends(get_current_user_optional)
):
    """Возвращает отзывы к товару с реакциями."""
    from app.models.reviews import ReviewReaction as ReviewReactionModel
    from sqlalchemy import func, literal
    
    # Подзапросы для лайков и дизлайков отзыва
    likes_sub = select(
        ReviewReactionModel.review_id,
        func.count(ReviewReactionModel.id).label("count")
    ).where(ReviewReactionModel.reaction_type == 1).group_by(ReviewReactionModel.review_id).subquery()

    dislikes_sub = select(
        ReviewReactionModel.review_id,
        func.count(ReviewReactionModel.id).label("count")
    ).where(ReviewReactionModel.reaction_type == -1).group_by(ReviewReactionModel.review_id).subquery()

    query = select(
        ReviewsModel,
        func.coalesce(likes_sub.c.count, 0).label("likes_count"),
        func.coalesce(dislikes_sub.c.count, 0).label("dislikes_count")
    ).outerjoin(likes_sub, ReviewsModel.id == likes_sub.c.review_id)\
     .outerjoin(dislikes_sub, ReviewsModel.id == dislikes_sub.c.review_id)\
     .where(ReviewsModel.product_id == product_id)\
     .where(ReviewsModel.is_active == True)\
     .options(joinedload(ReviewsModel.user))\
     .order_by(ReviewsModel.comment_date.desc())

    if current_user:
        my_reaction_sub = select(
            ReviewReactionModel.review_id,
            ReviewReactionModel.reaction_type
        ).where(ReviewReactionModel.user_id == current_user.id).subquery()
        query = query.add_columns(func.coalesce(my_reaction_sub.c.reaction_type, None).label("my_reaction"))\
                     .outerjoin(my_reaction_sub, ReviewsModel.id == my_reaction_sub.c.review_id)
    else:
        query = query.add_columns(literal(None).label("my_reaction"))

    result = await db.execute(query)
    
    response = []
    for row in result.all():
        r = row[0]
        review_dict = Review.model_validate(r).model_dump()
        review_dict["first_name"] = r.user.first_name
        review_dict["last_name"] = r.user.last_name
        review_dict["avatar_url"] = r.user.avatar_url
        review_dict["likes_count"] = row[1]
        review_dict["dislikes_count"] = row[2]
        review_dict["my_reaction"] = row[3]
        response.append(review_dict)
        
    return response
