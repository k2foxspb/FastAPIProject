from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func, case, delete, literal, or_, and_
from sqlalchemy.orm import selectinload
from typing import Annotated, Optional
import asyncio
import uuid
import io
from pathlib import Path
from PIL import Image
from app.utils import storage

from app.api.dependencies import get_async_db
from app.core.auth import get_current_user, get_current_admin, get_current_user_optional
from app.models.news import News as NewsModel, NewsImage as NewsImageModel, NewsReaction as NewsReactionModel, NewsComment as NewsCommentModel, NewsCommentReaction as NewsCommentReactionModel
from app.api.routers.notifications import manager as notification_manager
from app.core.fcm import send_fcm_notification
from app.models.users import User as UserModel, AppVersion as AppVersionModel, Friendship as FriendshipModel
from app.schemas.news import News as NewsSchema, NewsCreate, NewsUpdate, NewsComment as NewsCommentSchema, NewsCommentCreate
from app.schemas.users import AppVersionResponse

router = APIRouter(prefix="/news", tags=["news"])

async def notify_friends_about_news(news_id: int, author_id: int, author_name: str, news_title: str, db: AsyncSession):
    """Уведомляет друзей автора о новой новости."""
    from loguru import logger
    try:
        # Находим всех подтвержденных друзей автора
        res = await db.execute(
            select(UserModel).join(
                FriendshipModel,
                or_(
                    and_(FriendshipModel.user_id == author_id, FriendshipModel.friend_id == UserModel.id),
                    and_(FriendshipModel.friend_id == author_id, FriendshipModel.user_id == UserModel.id)
                )
            ).where(
                FriendshipModel.status == "accepted",
                UserModel.id != author_id
            ).execution_options(populate_existing=True)
        )
        friends = res.scalars().all()
        
        if not friends:
            logger.debug(f"FCM: No friends found to notify for author {author_id}")
            return

        msg_type = "new_post" # Или "new_news"
        notification_msg = {
            "type": msg_type,
            "news_id": news_id,
            "author_id": author_id,
            "author_name": author_name,
            "title": news_title
        }

        for friend in friends:
            # WebSocket уведомление
            asyncio.create_task(notification_manager.send_personal_message(notification_msg, friend.id))
            
            # FCM уведомление
            if friend.fcm_token:
                asyncio.create_task(send_fcm_notification(
                    token=friend.fcm_token,
                    title=f"Новая запись: {author_name}",
                    body=news_title if len(news_title) < 50 else f"{news_title[:47]}...",
                    data=notification_msg,
                    sender_id=author_id
                ))
        
        logger.info(f"FCM: Notifications sent to {len(friends)} friends of {author_id} for news {news_id}")
    except Exception as e:
        logger.error(f"FCM: Error notifying friends about news: {e}")

@router.get("/app-version/latest/", response_model=AppVersionResponse)
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
# Allow up to 10 MB to avoid crashes/timeouts on common mobile photos; reject bigger early
MAX_IMAGE_SIZE = 10 * 1024 * 1024

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

    # Try to produce thumbnail safely: pick format compatible with the extension
    thumb_url = original_url
    try:
        with Image.open(io.BytesIO(content)) as img:
            img.thumbnail((400, 400))
            thumb_buffer = io.BytesIO()
            # Choose an explicit format for BytesIO save to avoid relying on PIL inference
            if extension in [".jpg", ".jpeg"]:
                fmt = "JPEG"
            elif extension == ".png":
                fmt = "PNG"
            elif extension == ".webp":
                fmt = "WEBP"
            else:
                fmt = img.format or "PNG"
            try:
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
                # If saving thumbnail fails for any reason (unsupported codec, etc.),
                # fall back to original without breaking the request
                thumb_url = original_url
    except Exception:
        thumb_url = original_url
    return original_url, thumb_url

@router.get("/", response_model=list[NewsSchema])
async def get_news(
    db: AsyncSession = Depends(get_async_db),
    current_user: Optional[UserModel] = Depends(get_current_user_optional)
):
    """Возвращает только одобренные и активные новости с лайками."""
    # Подзапросы для лайков и дизлайков
    likes_sub = select(
        NewsReactionModel.news_id,
        func.count(NewsReactionModel.id).label("count")
    ).where(NewsReactionModel.reaction_type == 1).group_by(NewsReactionModel.news_id).subquery()

    dislikes_sub = select(
        NewsReactionModel.news_id,
        func.count(NewsReactionModel.id).label("count")
    ).where(NewsReactionModel.reaction_type == -1).group_by(NewsReactionModel.news_id).subquery()

    comments_sub = select(
        NewsCommentModel.news_id,
        func.count(NewsCommentModel.id).label("count")
    ).group_by(NewsCommentModel.news_id).subquery()

    # Базовый запрос
    query = select(
        NewsModel,
        func.coalesce(likes_sub.c.count, 0).label("likes_count"),
        func.coalesce(dislikes_sub.c.count, 0).label("dislikes_count"),
        func.coalesce(comments_sub.c.count, 0).label("comments_count")
    ).outerjoin(likes_sub, NewsModel.id == likes_sub.c.news_id)\
     .outerjoin(dislikes_sub, NewsModel.id == dislikes_sub.c.news_id)\
     .outerjoin(comments_sub, NewsModel.id == comments_sub.c.news_id)\
     .options(selectinload(NewsModel.author))

    # Если пользователь авторизован, добавляем его реакцию
    if current_user:
        my_reaction_sub = select(
            NewsReactionModel.news_id,
            NewsReactionModel.reaction_type
        ).where(NewsReactionModel.user_id == current_user.id).subquery()
        query = query.add_columns(func.coalesce(my_reaction_sub.c.reaction_type, None).label("my_reaction"))\
                     .outerjoin(my_reaction_sub, NewsModel.id == my_reaction_sub.c.news_id)
    else:
        from sqlalchemy import literal
        query = query.add_columns(literal(None).label("my_reaction"))

    query = query.options(selectinload(NewsModel.images)).where(
        NewsModel.moderation_status.in_(["approved", "pending", "rejected"]),
        NewsModel.is_active == True
    ).order_by(NewsModel.created_at.desc())

    result = await db.execute(query)
    news_list = []
    for row in result.all():
        news_obj = row[0]
        news_obj.likes_count = row[1]
        news_obj.dislikes_count = row[2]
        news_obj.comments_count = row[3]
        news_obj.my_reaction = row[4]
        
        if news_obj.author:
            news_obj.author_first_name = news_obj.author.first_name
            news_obj.author_last_name = news_obj.author.last_name
            news_obj.author_avatar_url = news_obj.author.avatar_url
            
        news_list.append(news_obj)
    return news_list

@router.get("/user/{user_id}", response_model=list[NewsSchema])
async def get_user_news(
    user_id: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: Optional[UserModel] = Depends(get_current_user_optional)
):
    """Возвращает новости конкретного автора."""
    # Подзапросы для лайков и дизлайков
    likes_sub = select(
        NewsReactionModel.news_id,
        func.count(NewsReactionModel.id).label("count")
    ).where(NewsReactionModel.reaction_type == 1).group_by(NewsReactionModel.news_id).subquery()

    dislikes_sub = select(
        NewsReactionModel.news_id,
        func.count(NewsReactionModel.id).label("count")
    ).where(NewsReactionModel.reaction_type == -1).group_by(NewsReactionModel.news_id).subquery()

    comments_sub = select(
        NewsCommentModel.news_id,
        func.count(NewsCommentModel.id).label("count")
    ).group_by(NewsCommentModel.news_id).subquery()

    # Базовый запрос
    query = select(
        NewsModel,
        func.coalesce(likes_sub.c.count, 0).label("likes_count"),
        func.coalesce(dislikes_sub.c.count, 0).label("dislikes_count"),
        func.coalesce(comments_sub.c.count, 0).label("comments_count")
    ).outerjoin(likes_sub, NewsModel.id == likes_sub.c.news_id)\
     .outerjoin(dislikes_sub, NewsModel.id == dislikes_sub.c.news_id)\
     .outerjoin(comments_sub, NewsModel.id == comments_sub.c.news_id)\
     .where(NewsModel.author_id == user_id)\
     .options(selectinload(NewsModel.author))

    # Если пользователь авторизован, добавляем его реакцию
    if current_user:
        my_reaction_sub = select(
            NewsReactionModel.news_id,
            NewsReactionModel.reaction_type
        ).where(NewsReactionModel.user_id == current_user.id).subquery()
        query = query.add_columns(func.coalesce(my_reaction_sub.c.reaction_type, None).label("my_reaction"))\
                     .outerjoin(my_reaction_sub, NewsModel.id == my_reaction_sub.c.news_id)
    else:
        query = query.add_columns(literal(None).label("my_reaction"))

    # Логика видимости: 
    # Если запрашиваем чужие новости - только approved
    # Если свои - все (включая pending/rejected)
    if not current_user or current_user.id != user_id:
        if not current_user or current_user.role not in ["admin", "owner"]:
            query = query.where(NewsModel.moderation_status.in_(["approved", "pending", "rejected"]))

    query = query.options(selectinload(NewsModel.images)).order_by(NewsModel.created_at.desc())

    result = await db.execute(query)
    news_list = []
    for row in result.all():
        news_obj = row[0]
        news_obj.likes_count = row[1]
        news_obj.dislikes_count = row[2]
        news_obj.comments_count = row[3]
        news_obj.my_reaction = row[4]
        
        if news_obj.author:
            news_obj.author_first_name = news_obj.author.first_name
            news_obj.author_last_name = news_obj.author.last_name
            news_obj.author_avatar_url = news_obj.author.avatar_url
            
        news_list.append(news_obj)
    return news_list

@router.post("/", response_model=NewsSchema, status_code=status.HTTP_201_CREATED)
async def create_news(
    title: str = Form(...),
    content: str = Form(...),
    images: list[UploadFile] = File(None),
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Создает новость. По умолчанию статус 'pending'."""
    from loguru import logger
    logger.info(f"NEWS_CREATE_DEBUG: Starting create_news for user {current_user.email}, title={title}")

    # 1. Сначала полностью вычитываем файлы из запроса
    validated_images_data: list[tuple[UploadFile, bytes]] = []
    if images:
        logger.info(f"NEWS_CREATE_DEBUG: Found images in request")
        # Обработка случая, когда images может содержать пустой файл или быть странного типа
        for img in images:
            if not img.filename:
                continue
            img_content = await img.read()
            if len(img_content) == 0:
                continue
            if len(img_content) > MAX_IMAGE_SIZE:
                logger.error(f"NEWS_CREATE_DEBUG: Image {img.filename} too large")
                raise HTTPException(400, f"Image {img.filename} is too large (>10MB)")
            if img.content_type not in ALLOWED_IMAGE_TYPES:
                logger.error(f"NEWS_CREATE_DEBUG: File {img.filename} invalid type {img.content_type}")
                raise HTTPException(400, f"File {img.filename} is not a valid image type")
            validated_images_data.append((img, img_content))
    
    try:
        # 2. Создаем объект новости
        db_news = NewsModel(
            title=title,
            content=content,
            author_id=current_user.id,
            moderation_status="approved" if current_user.role in ["admin", "owner"] else "pending"
        )
        db.add(db_news)

        # Нужно сделать flush, чтобы получить ID новости для связей картинок
        logger.info("NEWS_CREATE_DEBUG: Flushing news to DB")
        await db.flush()
        logger.info(f"NEWS_CREATE_DEBUG: News flushed, ID={db_news.id}")

        # 3. Обрабатываем картинки
        for idx, (img_file, img_bytes) in enumerate(validated_images_data):
            try:
                logger.info(f"NEWS_CREATE_DEBUG: Processing image {idx}")
                image_url, thumbnail_url = await _process_validated_image(img_file, img_bytes)

                if idx == 0:
                    db_news.image_url = image_url

                new_img = NewsImageModel(
                    news_id=db_news.id,
                    image_url=image_url,
                    thumbnail_url=thumbnail_url
                )
                db.add(new_img)
            except Exception as e:
                logger.error(f"NEWS_CREATE_DEBUG: Error processing image {idx}: {e}")

        # 4. Сохраняем всё в БД
        logger.info("NEWS_CREATE_DEBUG: Committing transaction")
        await db.commit()
        logger.info("NEWS_CREATE_DEBUG: Transaction committed, refreshing object")
        await db.refresh(db_news)

        # Загружаем со связями для ответа
        logger.info("NEWS_CREATE_DEBUG: Selecting final object with images")
        result = await db.execute(
            select(NewsModel)
            .options(selectinload(NewsModel.images))
            .where(NewsModel.id == db_news.id)
        )
        news_obj = result.scalar_one()
        logger.info(f"NEWS_CREATE_DEBUG: Returning created news ID={news_obj.id}")

        # 5. Уведомляем друзей
        if news_obj.moderation_status in ["approved", "pending"]:
            author_name = f"{current_user.first_name} {current_user.last_name}".strip() or current_user.email
            # Мы используем новую сессию или текущую, но уведомление асинхронное
            asyncio.create_task(notify_friends_about_news(
                news_id=news_obj.id,
                author_id=current_user.id,
                author_name=author_name,
                news_title=news_obj.title,
                db=db
            ))

        return news_obj
    except Exception as e:
        logger.exception(f"NEWS_CREATE_DEBUG: UNHANDLED ERROR in create_news: {e}")
        await db.rollback()
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))

async def _process_validated_image(file: UploadFile, content: bytes) -> tuple[str, str]:
    """Helper for create_news to save already-read image data safely."""
    extension = Path(file.filename or "").suffix.lower() or ".jpg"
    base_name = str(uuid.uuid4())

    # Save original
    original_url, _ = storage.save_file(
        category="news",
        filename_hint=f"{base_name}{extension}",
        fileobj=io.BytesIO(content),
        content_type=file.content_type or "image/jpeg",
        private=False,
    )

    # Save thumbnail
    thumb_url = original_url
    try:
        with Image.open(io.BytesIO(content)) as img:
            img.thumbnail((400, 400))
            thumb_buffer = io.BytesIO()
            if extension in [".jpg", ".jpeg"]:
                fmt = "JPEG"
            elif extension == ".png":
                fmt = "PNG"
            elif extension == ".webp":
                fmt = "WEBP"
            else:
                fmt = img.format or "PNG"
            try:
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
    except Exception:
        thumb_url = original_url
    return original_url, thumb_url

@router.post("/upload-media/", response_model=dict)
async def upload_news_media(
    file: UploadFile = File(...),
    current_user: UserModel = Depends(get_current_user),
):
    """Загружает одиночный медиафайл и возвращает его URL для вставки в текст."""
    image_url, _ = await save_news_image(file)
    return {"location": image_url, "url": image_url}

@router.get("/{news_id}/", response_model=NewsSchema)
async def get_news_detail(
    news_id: int, 
    db: AsyncSession = Depends(get_async_db),
    current_user: Optional[UserModel] = Depends(get_current_user_optional)
):
    # Запросы для лайков и дизлайков
    likes_sub = select(
        func.count(NewsReactionModel.id)
    ).where(NewsReactionModel.news_id == news_id, NewsReactionModel.reaction_type == 1)

    dislikes_sub = select(
        func.count(NewsReactionModel.id)
    ).where(NewsReactionModel.news_id == news_id, NewsReactionModel.reaction_type == -1)

    comments_count_sub = select(
        func.count(NewsCommentModel.id)
    ).where(NewsCommentModel.news_id == news_id)

    my_reaction_sub = select(
        NewsReactionModel.reaction_type
    ).where(NewsReactionModel.news_id == news_id, NewsReactionModel.user_id == current_user.id) if current_user else None

    result = await db.execute(select(NewsModel).options(selectinload(NewsModel.images), selectinload(NewsModel.author)).where(NewsModel.id == news_id))
    news = result.scalar_one_or_none()
    if not news:
        raise HTTPException(status_code=404, detail="News not found")
    
    # Добавляем данные о реакциях
    news.likes_count = await db.scalar(likes_sub)
    news.dislikes_count = await db.scalar(dislikes_sub)
    news.comments_count = await db.scalar(comments_count_sub)
    news.my_reaction = await db.scalar(my_reaction_sub) if my_reaction_sub is not None else None
    
    if news.author:
        news.author_first_name = news.author.first_name
        news.author_last_name = news.author.last_name
        news.author_avatar_url = news.author.avatar_url
    
    return news

@router.post("/{news_id}/react")
async def react_to_news(
    news_id: int,
    reaction_type: int, # 1 for like, -1 for dislike, 0 to remove
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Поставить лайк или дизлайк новости."""
    if reaction_type not in [1, -1, 0]:
        raise HTTPException(status_code=400, detail="Invalid reaction type")

    # Проверяем существование новости
    news_res = await db.execute(select(NewsModel.id).where(NewsModel.id == news_id))
    if not news_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="News not found")

    # Ищем существующую реакцию
    reaction_res = await db.execute(
        select(NewsReactionModel).where(
            NewsReactionModel.news_id == news_id,
            NewsReactionModel.user_id == current_user.id
        )
    )
    db_reaction = reaction_res.scalar_one_or_none()

    if reaction_type == 0:
        if db_reaction:
            await db.delete(db_reaction)
            await db.commit()
            return {"status": "removed"}
        return {"status": "not_found"}
    
    if db_reaction:
        db_reaction.reaction_type = reaction_type
    else:
        new_reaction = NewsReactionModel(
            news_id=news_id,
            user_id=current_user.id,
            reaction_type=reaction_type
        )
        db.add(new_reaction)
    
    await db.commit()
    return {"status": "ok", "reaction_type": reaction_type}

@router.get("/{news_id}/comments", response_model=list[NewsCommentSchema])
async def get_news_comments(
    news_id: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: Optional[UserModel] = Depends(get_current_user_optional)
):
    """Получить список комментариев к новости с реакциями."""
    # Проверяем существование новости
    news_res = await db.execute(select(NewsModel.id).where(NewsModel.id == news_id))
    if not news_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="News not found")

    # Подзапросы для лайков и дизлайков комментария
    likes_sub = select(
        NewsCommentReactionModel.comment_id,
        func.count(NewsCommentReactionModel.id).label("count")
    ).where(NewsCommentReactionModel.reaction_type == 1).group_by(NewsCommentReactionModel.comment_id).subquery()

    dislikes_sub = select(
        NewsCommentReactionModel.comment_id,
        func.count(NewsCommentReactionModel.id).label("count")
    ).where(NewsCommentReactionModel.reaction_type == -1).group_by(NewsCommentReactionModel.comment_id).subquery()

    query = select(
        NewsCommentModel,
        func.coalesce(likes_sub.c.count, 0).label("likes_count"),
        func.coalesce(dislikes_sub.c.count, 0).label("dislikes_count")
    ).outerjoin(likes_sub, NewsCommentModel.id == likes_sub.c.comment_id)\
     .outerjoin(dislikes_sub, NewsCommentModel.id == dislikes_sub.c.comment_id)\
     .where(NewsCommentModel.news_id == news_id)\
     .options(selectinload(NewsCommentModel.user))\
     .order_by(NewsCommentModel.created_at.asc())

    if current_user:
        my_reaction_sub = select(
            NewsCommentReactionModel.comment_id,
            NewsCommentReactionModel.reaction_type
        ).where(NewsCommentReactionModel.user_id == current_user.id).subquery()
        query = query.add_columns(func.coalesce(my_reaction_sub.c.reaction_type, None).label("my_reaction"))\
                     .outerjoin(my_reaction_sub, NewsCommentModel.id == my_reaction_sub.c.comment_id)
    else:
        from sqlalchemy import literal
        query = query.add_columns(literal(None).label("my_reaction"))

    result = await db.execute(query)
    
    response = []
    for row in result.all():
        c = row[0]
        comment_dict = NewsCommentSchema.model_validate(c).model_dump()
        comment_dict["first_name"] = c.user.first_name
        comment_dict["last_name"] = c.user.last_name
        comment_dict["avatar_url"] = c.user.avatar_url
        comment_dict["likes_count"] = row[1]
        comment_dict["dislikes_count"] = row[2]
        comment_dict["my_reaction"] = row[3]
        response.append(comment_dict)
        
    return response

@router.post("/comments/{comment_id}/react")
async def react_to_news_comment(
    comment_id: int,
    reaction_type: int, # 1 for like, -1 for dislike, 0 to remove
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Поставить лайк или дизлайк комментарию к новости."""
    if reaction_type not in [1, -1, 0]:
        raise HTTPException(status_code=400, detail="Invalid reaction type")

    # Проверяем существование комментария
    comment_res = await db.execute(select(NewsCommentModel.id).where(NewsCommentModel.id == comment_id))
    if not comment_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Comment not found")

    # Ищем существующую реакцию
    reaction_res = await db.execute(
        select(NewsCommentReactionModel).where(
            NewsCommentReactionModel.comment_id == comment_id,
            NewsCommentReactionModel.user_id == current_user.id
        )
    )
    db_reaction = reaction_res.scalar_one_or_none()

    if reaction_type == 0:
        if db_reaction:
            await db.delete(db_reaction)
            await db.commit()
            return {"status": "removed"}
        return {"status": "not_found"}
    
    if db_reaction:
        db_reaction.reaction_type = reaction_type
    else:
        new_reaction = NewsCommentReactionModel(
            comment_id=comment_id,
            user_id=current_user.id,
            reaction_type=reaction_type
        )
        db.add(new_reaction)
    
    await db.commit()
    return {"status": "ok", "reaction_type": reaction_type}

@router.post("/{news_id}/comments", response_model=NewsCommentSchema)
async def add_news_comment(
    news_id: int,
    comment_data: NewsCommentCreate,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Добавить комментарий к новости."""
    news_res = await db.execute(select(NewsModel.id).where(NewsModel.id == news_id))
    if not news_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="News not found")

    new_comment = NewsCommentModel(
        news_id=news_id,
        user_id=current_user.id,
        comment=comment_data.comment
    )
    db.add(new_comment)
    await db.commit()
    await db.refresh(new_comment)
    
    # Загружаем со связью пользователя для ответа
    result = await db.execute(
        select(NewsCommentModel).options(selectinload(NewsCommentModel.user)).where(NewsCommentModel.id == new_comment.id)
    )
    comment_obj = result.scalar_one()
    
    response = NewsCommentSchema.model_validate(comment_obj).model_dump()
    response["first_name"] = comment_obj.user.first_name
    response["last_name"] = comment_obj.user.last_name
    response["avatar_url"] = comment_obj.user.avatar_url
    
    return response

@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_news_comment(
    comment_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Удалить свой комментарий или любой комментарий если ты админ."""
    result = await db.execute(
        select(NewsCommentModel).options(selectinload(NewsCommentModel.news)).where(NewsCommentModel.id == comment_id)
    )
    comment = result.scalar_one_or_none()
    
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
        
    # Удалить может автор комментария или админ
    if comment.user_id != current_user.id and current_user.role not in ["admin", "owner"]:
        raise HTTPException(status_code=403, detail="Not enough permissions")
        
    await db.delete(comment)
    await db.commit()
    return None

@router.patch("/{news_id}/", response_model=NewsSchema)
async def update_news(
    news_id: int,
    news_in: NewsUpdate,
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

    update_data = news_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_news, field, value)
    
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

@router.delete("/{news_id}/", status_code=status.HTTP_204_NO_CONTENT)
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
