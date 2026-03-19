import asyncio
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update, func
from sqlalchemy.orm import joinedload, selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_buyer, get_current_user, get_current_user_optional
from app.api.dependencies import get_async_db
from app.models.reviews import Reviews as ReviewModel, ReviewReaction as ReviewReactionModel
from app.models.users import User as UserModel
from app.models.products import Product as ProductModel
from app.schemas.reviews import Review as ReviewSchema, Review, CreateReview
from app.api.routers.notifications import manager
from app.core.fcm import send_fcm_notification

router = APIRouter(
    prefix="/reviews",
    tags=["reviews"],
)

@router.post("/{review_id}/react")
async def react_to_review(
    review_id: int,
    reaction_type: int, # 1 for like, -1 for dislike, 0 to remove
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Поставить лайк или дизлайк отзыву к товару."""
    if reaction_type not in [1, -1, 0]:
        raise HTTPException(status_code=400, detail="Invalid reaction type")

    # Проверяем существование отзыва (загружаем с автором для уведомлений)
    review_res = await db.execute(
        select(ReviewModel)
        .options(selectinload(ReviewModel.user))
        .where(ReviewModel.id == review_id)
    )
    review_obj = review_res.scalar_one_or_none()
    if not review_obj:
        raise HTTPException(status_code=404, detail="Review not found")

    # Ищем существующую реакцию
    reaction_res = await db.execute(
        select(ReviewReactionModel).where(
            ReviewReactionModel.review_id == review_id,
            ReviewReactionModel.user_id == current_user.id
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
        new_reaction = ReviewReactionModel(
            review_id=review_id,
            user_id=current_user.id,
            reaction_type=reaction_type
        )
        db.add(new_reaction)
    
    await db.commit()

    # Уведомление владельцу отзыва
    if review_obj.user_id != current_user.id:
        action = "лайк" if reaction_type == 1 else "дизлайк"
        msg = {
            "type": "review_reaction",
            "review_id": review_id,
            "reaction_type": reaction_type,
            "sender_id": current_user.id,
            "sender_name": f"{current_user.first_name} {current_user.last_name}" if current_user.first_name else current_user.email,
            "message": f"поставил {action} вашему отзыву: {review_obj.comment[:50]}..."
        }
        await manager.send_personal_message(msg, review_obj.user_id)
        
        if review_obj.user.fcm_token:
             asyncio.create_task(send_fcm_notification(
                token=review_obj.user.fcm_token,
                title="Реакция на ваш отзыв",
                body=f"{msg['sender_name']} {msg['message']}",
                data=msg,
                sender_id=current_user.id,
                sender_avatar=current_user.avatar_url
            ))

    return {"status": "ok", "reaction_type": reaction_type}

@router.get("", response_model=list[ReviewSchema])
async def get_review(
    db: AsyncSession = Depends(get_async_db),
    current_user: Optional[UserModel] = Depends(get_current_user_optional)
):
    result = await db.execute(
        select(ReviewModel)
        .options(
            joinedload(ReviewModel.user),
            selectinload(ReviewModel.reactions).selectinload(ReviewReactionModel.user)
        )
        .where(ReviewModel.is_active == True)
    )
    reviews = result.scalars().unique().all()
    for r in reviews:
        r.first_name = r.user.first_name
        r.last_name = r.user.last_name
        r.avatar_url = r.user.avatar_url
        
        r.likes_count = sum(1 for re in r.reactions if re.reaction_type == 1)
        r.dislikes_count = sum(1 for re in r.reactions if re.reaction_type == -1)
        
        if current_user:
            r.my_reaction = next((re.reaction_type for re in r.reactions if re.user_id == current_user.id), None)
        else:
            r.my_reaction = None
            
        r.liked_by = [re.user for re in r.reactions if re.reaction_type == 1]
        r.disliked_by = [re.user for re in r.reactions if re.reaction_type == -1]
        
    return reviews

@router.post('', response_model=Review)
async def create_review(review: CreateReview,
                        db: AsyncSession = Depends(get_async_db),
                        current_buyer: UserModel = Depends(get_current_buyer)
                        ):
    product = await db.scalars(select(ProductModel)
                                      .where(ProductModel.id == review.product_id)
                                      .where(ProductModel.is_active == True))
    product_result = product.first()
    if not product_result:
        raise HTTPException(status_code=400, detail="Product not exist")
    review_query = await db.scalars(select(ReviewModel)
                                     .where(ReviewModel.is_active == True)
                                     .where(ReviewModel.product_id == product_result.id))
    reviews_list = review_query.all()
    if reviews_list:

        avg_rating = (sum([r.grade for r in reviews_list]) + review.grade) / (len(reviews_list) + 1)
    else:
        # Если это первый отзыв
        avg_rating = review.grade
    await db.execute(
        update(ProductModel)
        .where(ProductModel.id == product_result.id)
        .values(rating=avg_rating)
    )
    db_review = ReviewModel(
        user_id=current_buyer.id,
        product_id=review.product_id,
        comment=review.comment,
        grade=review.grade,
        comment_date=datetime.now(),
        is_active=True
    )
    db.add(db_review)
    await db.commit()
    await db.refresh(db_review)
    await db.refresh(product_result)

    # Отправка уведомления продавцу о новом отзыве
    await manager.send_personal_message(
        {
            "type": "new_review",
            "product_id": product_result.id,
            "product_name": product_result.name,
            "rating": review.grade,
            "comment": review.comment
        },
        product_result.seller_id
    )

    return db_review

@router.delete('/reviews/{review_id}')
async def delete_review(review_id: int,
                        db: AsyncSession = Depends(get_async_db),
                        user: UserModel = Depends(get_current_user)):
    review = await db.scalars(select(ReviewModel).where(ReviewModel.id == review_id))
    review_result = review.first()
    if review_result.user_id == user.id or user.role == 'admin':
        await db.execute(
            update(ReviewModel).where(
                ProductModel.id == review_id
            ).values(is_active=False)
        )
        await db.commit()
    else:
        raise HTTPException(status_code=403, detail="You are not allowed to delete this review")
    return {"message": "Review deleted successfully"}