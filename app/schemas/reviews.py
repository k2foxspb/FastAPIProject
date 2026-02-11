from datetime import datetime

from pydantic import BaseModel, Field


class Review(BaseModel):
    id: int = Field(description='id комментария')
    user_id: int = Field(description='id владелеца коментария')
    product_id: int = Field('id продукта к которому оставлен комментарий')
    comment: str = Field(description='комментарий')
    comment_date: datetime = Field(description='дата комментария')
    grade: int = Field(ge=1, le=5, description='оценка от 1 до 5')


class CreateReview(BaseModel):
    product_id: int = Field(description='id продукта')
    comment: str | None = Field(None, description='комментарий', )
    grade: int = Field(ge=1, le=5, description='оценка от 1 до 5')



