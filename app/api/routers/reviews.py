from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_buyer, get_current_user
from app.api.dependencies import get_async_db
from app.models import (Reviews as ReviewModel,
                        User as UserModel,
                        Product as ProductModel)
from app.schemas.reviews import Review as ReviewSchema, Review, CreateReview

router = APIRouter(
    prefix="/reviews",
    tags=["reviews"],
)

@router.get('/', response_model=list[ReviewSchema])
async def get_review(db: AsyncSession = Depends(get_async_db)):
    result = await db.scalars(select(ReviewModel).where(ReviewModel.is_active == True))
    return result.all()

@router.post('/', response_model=Review)
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