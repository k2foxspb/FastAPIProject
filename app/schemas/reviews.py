from datetime import datetime

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional


class Review(BaseModel):
    id: int = Field(description='id комментария')
    user_id: int = Field(description='id владелеца коментария')
    product_id: int = Field('id продукта к которому оставлен комментарий')
    comment: str = Field(description='комментарий')
    comment_date: datetime = Field(description='дата комментария')
    grade: int = Field(ge=1, le=5, description='оценка от 1 до 5')
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar_url: Optional[str] = None
    likes_count: int = 0
    dislikes_count: int = 0
    my_reaction: int | None = None

    model_config = ConfigDict(from_attributes=True)


class CreateReview(BaseModel):
    product_id: int = Field(description='id продукта')
    comment: str | None = Field(None, description='комментарий', )
    grade: int = Field(ge=1, le=5, description='оценка от 1 до 5')



