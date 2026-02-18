from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload
from typing import Annotated, Optional
import uuid
import io
from pathlib import Path
from PIL import Image
from app.utils import storage

from app.api.dependencies import get_async_db
from app.core.auth import get_current_user, get_current_admin
from app.models.news import News as NewsModel, NewsImage as NewsImageModel
from app.models.users import User as UserModel, AppVersion as AppVersionModel
from app.schemas.news import News as NewsSchema, NewsCreate, NewsUpdate
from app.schemas.users import AppVersionResponse

router = APIRouter(prefix="/news", tags=["news"])

@router.get("/app-version/latest", response_model=AppVersionResponse)
async def get_latest_app_version(db: AsyncSession = Depends(get_async_db)):
    """Возвращает последнюю версию приложения."""
    from sqlalchemy import desc
    result = await db.execute(select(AppVersionModel).order_by(desc(AppVersionModel.created_at)).limit(1))
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="No app versions found")
    return version

BASE_DIR = Path(__file__).resolve().parent.parent.parent
MEDIA_ROOT = BASE_DIR / "app" / "media" / "news"
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_SIZE = 2 * 1024 * 1024

async def save_news_image(file: UploadFile) -> tuple[str, str]:
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, "Only JPG, PNG or WebP images are allowed")
    content = await file.read()
    if len(content) > MAX_IMAGE_SIZE:
        raise HTTPException(400, "Image is too large")
    extension = Path(file.filename or "").suffix.lower() or ".jpg"
    base_name = str(uuid.uuid4())

    # Save original via storage abstraction
    original_url, _ = storage.save_file(
        category="news",
        filename_hint=f"{base_name}{extension}",
        fileobj=io.BytesIO(content),
        content_type=file.content_type or "image/jpeg",
        private=False,
    )

    # Try to produce thumbnail
    thumb_url = original_url
    try:
        with Image.open(io.BytesIO(content)) as img:
            img.thumbnail((400, 400))
            thumb_buffer = io.BytesIO()
            fmt = "JPEG" if extension in [".jpg", ".jpeg"] else None
            img.save(thumb_buffer, format=fmt)
            thumb_buffer.seek(0)
            thumb_url, _ = storage.save_file(
                category="news",
                filename_hint=f"{base_name}_thumb{extension}",
                fileobj=thumb_buffer,
                content_type=file.content_type or "image/jpeg",
                private=False,
            )
    except Exception:
        thumb_url = original_url
    return original_url, thumb_url

@router.get("", response_model=list[NewsSchema])
async def get_news(db: AsyncSession = Depends(get_async_db)):
    """Возвращает только одобренные и активные новости."""
    result = await db.execute(
        select(NewsModel).options(selectinload(NewsModel.images)).where(
            NewsModel.moderation_status == "approved",
            NewsModel.is_active == True
        ).order_by(NewsModel.created_at.desc())
    )
    return result.scalars().all()

@router.post("", response_model=NewsSchema, status_code=status.HTTP_201_CREATED)
async def create_news(
    title: str = Form(...),
    content: str = Form(...),
    images: list[UploadFile] = File(None),
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Создает новость. По умолчанию статус 'pending'."""
    db_news = NewsModel(
        title=title,
        content=content,
        author_id=current_user.id,
        moderation_status="approved" if current_user.role in ["admin", "owner"] else "pending"
    )
    
    if images:
        for idx, img in enumerate(images):
            image_url, thumbnail_url = await save_news_image(img)
            if idx == 0:
                db_news.image_url = image_url
            db_news.images.append(NewsImageModel(
                image_url=image_url,
                thumbnail_url=thumbnail_url
            ))
            
    db.add(db_news)
    await db.commit()
    await db.refresh(db_news)
    # Reload with images
    result = await db.execute(select(NewsModel).options(selectinload(NewsModel.images)).where(NewsModel.id == db_news.id))
    return result.scalar_one()

@router.get("/{news_id}", response_model=NewsSchema)
async def get_news_detail(news_id: int, db: AsyncSession = Depends(get_async_db)):
    result = await db.execute(select(NewsModel).options(selectinload(NewsModel.images)).where(NewsModel.id == news_id))
    news = result.scalar_one_or_none()
    if not news:
        raise HTTPException(status_code=404, detail="News not found")
    return news

@router.patch("/{news_id}", response_model=NewsSchema)
async def update_news(
    news_id: int,
    title: Optional[str] = Form(None),
    content: Optional[str] = Form(None),
    is_active: Optional[bool] = Form(None),
    images: list[UploadFile] = File(None),
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    result = await db.execute(
        select(NewsModel).options(selectinload(NewsModel.images)).where(NewsModel.id == news_id)
    )
    db_news = result.scalar_one_or_none()
    if not db_news:
        raise HTTPException(status_code=404, detail="News not found")
    
    # Редактировать может автор или админ
    if db_news.author_id != current_user.id and current_user.role not in ["admin", "owner"]:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    if title is not None:
        db_news.title = title
    if content is not None:
        db_news.content = content
    if is_active is not None:
        db_news.is_active = is_active
    
    if images:
        for img in images:
            image_url, thumbnail_url = await save_news_image(img)
            # Если у новости еще нет обложки, ставим первую загруженную
            if not db_news.image_url:
                db_news.image_url = image_url
            db_news.images.append(NewsImageModel(
                image_url=image_url,
                thumbnail_url=thumbnail_url
            ))
    
    # Если редактирует автор (не админ), сбрасываем модерацию
    if current_user.role not in ["admin", "owner"]:
        db_news.moderation_status = "pending"

    await db.commit()
    await db.refresh(db_news)
    
    # Reload with images to avoid lazy loading issues during serialization
    result = await db.execute(
        select(NewsModel).options(selectinload(NewsModel.images)).where(NewsModel.id == db_news.id)
    )
    return result.scalar_one()

@router.delete("/{news_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_news(
    news_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    result = await db.execute(select(NewsModel).where(NewsModel.id == news_id))
    db_news = result.scalar_one_or_none()
    if not db_news:
        raise HTTPException(status_code=404, detail="News not found")
    
    if db_news.author_id != current_user.id and current_user.role not in ["admin", "owner"]:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    # Соберём URL для удаления до удаления записей из БД
    paths_to_delete: list[str] = []
    if db_news.image_url:
        paths_to_delete.append(db_news.image_url)
    imgs_res = await db.execute(select(NewsImageModel).where(NewsImageModel.news_id == news_id))
    for img in imgs_res.scalars().all():
        paths_to_delete.append(img.image_url)
        if img.thumbnail_url and img.thumbnail_url != img.image_url:
            paths_to_delete.append(img.thumbnail_url)

    await db.delete(db_news)
    await db.commit()

    # Удаление файлов из хранилища
    try:
        from app.utils import storage as _storage
        for path in paths_to_delete:
            try:
                if path.startswith("http"):
                    parts = path.split("/")
                    if len(parts) > 4:
                        key = "/".join(parts[4:])
                        _storage.delete("news", key)
                else:
                    _storage.delete("news", path)
            except Exception as e:
                print(f"news.delete: failed to delete {path}: {e}")
    except Exception as e:
        print(f"news.delete: storage error: {e}")

    return None
