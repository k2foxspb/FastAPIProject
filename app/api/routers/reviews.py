from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_buyer, get_current_user
from app.api.dependencies import get_async_db
from app.models.reviews import Reviews as ReviewModel, ReviewReaction as ReviewReactionModel
from app.models.users import User as UserModel
from app.models.products import Product as ProductModel
from app.schemas.reviews import Review as ReviewSchema, Review, CreateReview
from app.api.routers.notifications import manager

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

    # Проверяем существование отзыва
    review_res = await db.execute(select(ReviewModel.id).where(ReviewModel.id == review_id))
    if not review_res.scalar_one_or_none():
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
    return {"status": "ok", "reaction_type": reaction_type}

@router.get("", response_model=list[ReviewSchema])
async def get_review(db: AsyncSession = Depends(get_async_db)):
    result = await db.execute(
        select(ReviewModel)
        .options(joinedload(ReviewModel.user))
        .where(ReviewModel.is_active == True)
    )
    reviews = result.scalars().all()
    for r in reviews:
        r.first_name = r.user.first_name
        r.last_name = r.user.last_name
        r.avatar_url = r.user.avatar_url
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