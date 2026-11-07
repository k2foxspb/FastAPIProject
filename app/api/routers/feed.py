"""
Объединённая лента: новости (News) + публикации профиля (ProfilePost, включая
объявления post_type="announcement"), отсортированные по дате создания.
"""
import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, or_, and_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_async_db, get_friendship_status, can_view_content
from app.core.auth import get_current_user, get_current_admin, get_current_user_optional
from app.models.news import News as NewsModel, NewsReaction as NewsReactionModel, NewsComment as NewsCommentModel
from app.models.users import (
    User as UserModel,
    ProfilePost as ProfilePostModel,
    ProfilePostReaction as ProfilePostReactionModel,
    ProfilePostComment as ProfilePostCommentModel,
    Friendship as FriendshipModel,
)
from app.schemas.users import ProfilePostCreate, get_default_avatar_url

router = APIRouter(prefix="/feed", tags=["feed"])


def _author_info(user: UserModel | None) -> dict:
    if user is None:
        return {"id": None, "first_name": None, "last_name": None, "avatar_url": None}
    return {
        "id": user.id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "avatar_url": user.avatar_url or get_default_avatar_url(user.gender),
    }


def _news_to_feed_item(news: NewsModel, current_user_id: int | None) -> dict:
    my_reaction = None
    for r in getattr(news, "reactions", []) or []:
        if r.user_id == current_user_id:
            my_reaction = r.reaction_type
            break
    return {
        "item_type": "news",
        "id": news.id,
        "title": news.title,
        "content": news.content,
        "media_url": news.image_url,
        "author": _author_info(news.author),
        "author_id": news.author_id,
        "created_at": news.created_at,
        "updated_at": news.updated_at,
        "privacy": "public",
        "moderation_status": news.moderation_status,
        "is_hidden": False,
        "likes_count": sum(1 for r in getattr(news, "reactions", []) or [] if r.reaction_type == 1),
        "dislikes_count": sum(1 for r in getattr(news, "reactions", []) or [] if r.reaction_type == -1),
        "comments_count": len(getattr(news, "comments", []) or []),
        "my_reaction": my_reaction,
    }


def _post_to_feed_item(post: ProfilePostModel, current_user_id: int | None) -> dict:
    my_reaction = None
    for r in getattr(post, "reactions", []) or []:
        if r.user_id == current_user_id:
            my_reaction = r.reaction_type
            break
    item_type = "announcement" if post.post_type == "announcement" else "post"
    return {
        "item_type": item_type,
        "id": post.id,
        "title": None,
        "content": post.content,
        "media_url": post.media_url,
        "media_type": post.media_type,
        "author": _author_info(post.user),
        "author_id": post.user_id,
        "created_at": post.created_at,
        "updated_at": post.updated_at,
        "privacy": post.privacy,
        "moderation_status": post.moderation_status,
        "is_hidden": post.is_hidden,
        "likes_count": len(getattr(post, "reactions", []) or []),
        "comments_count": len(getattr(post, "comments", []) or []),
        "my_reaction": my_reaction,
    }


@router.get("")
@router.get("/", include_in_schema=False)
async def get_feed(
    skip: int = 0,
    limit: int = 30,
    current_user: UserModel | None = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Возвращает объединённую ленту из новостей и публикаций профиля (включая
    объявления), отсортированную по дате создания (новые сверху), с учётом
    приватности постов. Каждый элемент содержит поле item_type:
    "news" | "post" | "announcement".
    """
    current_user_id = current_user.id if current_user else None

    news_res = await db.execute(
        select(NewsModel)
        .options(
            selectinload(NewsModel.author),
            selectinload(NewsModel.reactions),
            selectinload(NewsModel.comments),
        )
        .where(
            NewsModel.is_active == True,
            NewsModel.moderation_status.in_(["pending", "approved"]),
        )
    )
    news_items = [_news_to_feed_item(n, current_user_id) for n in news_res.scalars().all()]

    posts_res = await db.execute(
        select(ProfilePostModel)
        .options(
            selectinload(ProfilePostModel.user),
            selectinload(ProfilePostModel.reactions),
            selectinload(ProfilePostModel.comments),
        )
        .where(
            ProfilePostModel.is_active == True,
        )
    )
    posts = posts_res.scalars().all()

    # Скрытые публикации видят только их автор и администраторы/владелец -
    # остальным пользователям (включая анонимных) они не показываются.
    is_moderator = current_user is not None and current_user.role in ("admin", "owner")

    def _can_see_hidden(post: ProfilePostModel) -> bool:
        if not post.is_hidden:
            return True
        return is_moderator or (current_user_id is not None and post.user_id == current_user_id)

    # Предзагружаем статусы дружбы одним запросом, чтобы не делать N+1
    friendship_cache: dict[int, str | None] = {}

    async def _friendship(author_id: int) -> str | None:
        if current_user_id is None:
            return None
        if author_id == current_user_id:
            return "self"
        if author_id not in friendship_cache:
            friendship_cache[author_id] = await get_friendship_status(db, current_user_id, author_id)
        return friendship_cache[author_id]

    post_items = []
    for p in posts:
        if not _can_see_hidden(p):
            continue
        friendship_status = await _friendship(p.user_id)
        if p.post_type != "announcement" and friendship_status not in ("accepted", "self"):
            continue
        if can_view_content(p.user_id, current_user_id, p.privacy, friendship_status):
            post_items.append(_post_to_feed_item(p, current_user_id))

    all_items = news_items + post_items
    all_items.sort(key=lambda i: i["created_at"], reverse=True)

    total = len(all_items)
    page = all_items[skip:skip + limit]

    return {"items": page, "total": total, "skip": skip, "limit": limit}


@router.get("/posts/{post_id}")
async def get_feed_post(
    post_id: int,
    current_user: UserModel | None = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Возвращает одну публикацию профиля (пост или объявление) в том же
    формате, что и элементы ленты (item_type/author/...) - используется для
    перехода на публикацию из уведомления, где доступен только её id.
    """
    current_user_id = current_user.id if current_user else None

    res = await db.execute(
        select(ProfilePostModel)
        .options(
            selectinload(ProfilePostModel.user),
            selectinload(ProfilePostModel.reactions),
            selectinload(ProfilePostModel.comments),
        )
        .where(ProfilePostModel.id == post_id, ProfilePostModel.is_active == True)
    )
    post = res.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Публикация не найдена")

    is_moderator = current_user is not None and current_user.role in ("admin", "owner")
    if post.is_hidden and not is_moderator and post.user_id != current_user_id:
        raise HTTPException(status_code=404, detail="Публикация не найдена")

    friendship_status = await get_friendship_status(db, current_user_id, post.user_id) if current_user_id else None
    if not can_view_content(post.user_id, current_user_id, post.privacy, friendship_status):
        raise HTTPException(status_code=403, detail="Доступ запрещен настройками приватности")

    return _post_to_feed_item(post, current_user_id)


@router.post("/announcements", status_code=status.HTTP_201_CREATED)
async def create_announcement(
    data: ProfilePostCreate,
    current_user: UserModel = Depends(get_current_admin),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Создаёт объявление (ProfilePost с post_type="announcement", всегда
    privacy="public") и рассылает неотключаемое уведомление всем активным
    пользователям. Доступно только admin/owner.
    """
    post = ProfilePostModel(
        user_id=current_user.id,
        content=data.content,
        media_url=data.media_url,
        media_type=data.media_type,
        privacy="public",
        post_type="announcement",
        moderation_status="approved",
        is_active=True,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)

    from app.core.notification_service import create_or_group_notification

    users_res = await db.execute(select(UserModel).where(UserModel.is_active == True))
    users = users_res.scalars().all()

    author_name = f"{current_user.first_name or ''} {current_user.last_name or ''}".strip() or current_user.email or "Администрация"
    title = "Новое объявление"
    body = (data.content or "")[:200]

    for user in users:
        if user.id == current_user.id:
            continue
        await create_or_group_notification(
            db,
            user_id=user.id,
            notif_type="announcement",
            title=title,
            body=f"{author_name}: {body}" if body else title,
            data={"object_type": "profile_post", "object_id": post.id},
            actor_id=current_user.id,
            is_unremovable=True,
        )

    return {"status": "ok", "id": post.id}
