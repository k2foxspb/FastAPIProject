from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.api.dependencies import get_async_db
from app.core.auth import get_current_user, get_current_admin
from app.models.news import News as NewsModel
from app.models.users import User as UserModel
from app.schemas.news import News as NewsSchema, NewsCreate, NewsUpdate

router = APIRouter(prefix="/news", tags=["news"])

@router.get("", response_model=list[NewsSchema])
async def get_news(db: AsyncSession = Depends(get_async_db)):
    """Возвращает только одобренные и активные новости."""
    result = await db.execute(
        select(NewsModel).where(
            NewsModel.moderation_status == "approved",
            NewsModel.is_active == True
        ).order_by(NewsModel.created_at.desc())
    )
    return result.scalars().all()

@router.post("", response_model=NewsSchema, status_code=status.HTTP_201_CREATED)
async def create_news(
    news_in: NewsCreate,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Создает новость. По умолчанию статус 'pending'."""
    db_news = NewsModel(
        **news_in.model_dump(),
        author_id=current_user.id,
        moderation_status="pending"
    )
    db.add(db_news)
    await db.commit()
    await db.refresh(db_news)
    return db_news

@router.get("/{news_id}", response_model=NewsSchema)
async def get_news_detail(news_id: int, db: AsyncSession = Depends(get_async_db)):
    result = await db.execute(select(NewsModel).where(NewsModel.id == news_id))
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
