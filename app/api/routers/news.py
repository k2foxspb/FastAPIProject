from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload
from typing import Annotated, Optional
import uuid
import io
from pathlib import Path
from PIL import Image

from app.api.dependencies import get_async_db
from app.core.auth import get_current_user, get_current_admin
from app.models.news import News as NewsModel, NewsImage as NewsImageModel
from app.models.users import User as UserModel
from app.schemas.news import News as NewsSchema, NewsCreate, NewsUpdate

router = APIRouter(prefix="/news", tags=["news"])

BASE_DIR = Path(__file__).resolve().parent.parent.parent
MEDIA_ROOT = BASE_DIR / "media" / "news"
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
    file_name = f"{base_name}{extension}"
    file_path = MEDIA_ROOT / file_name
    file_path.write_bytes(content)
    thumb_name = f"{base_name}_thumb{extension}"
    thumb_path = MEDIA_ROOT / thumb_name
    try:
        with Image.open(io.BytesIO(content)) as img:
            img.thumbnail((400, 400))
            img.save(thumb_path)
    except Exception:
        thumb_name = file_name
    return f"/media/news/{file_name}", f"/media/news/{thumb_name}"

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
    news_in: NewsUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    result = await db.execute(select(NewsModel).where(NewsModel.id == news_id))
    db_news = result.scalar_one_or_none()
    if not db_news:
        raise HTTPException(status_code=404, detail="News not found")
    
    # Редактировать может автор или админ
    if db_news.author_id != current_user.id and current_user.role not in ["admin", "owner"]:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    update_data = news_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_news, field, value)
    
    # Если редактирует автор (не админ), сбрасываем модерацию
    if current_user.role not in ["admin", "owner"]:
        db_news.moderation_status = "pending"

    await db.commit()
    await db.refresh(db_news)
    return db_news

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

    await db.delete(db_news)
    await db.commit()
    return None
