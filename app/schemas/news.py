from datetime import datetime
from pydantic import Field, BaseModel, ConfigDict

class NewsCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    content: str = Field(min_length=10)
    image_url: str | None = None

class NewsUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    image_url: str | None = None
    is_active: bool | None = None

class NewsImage(BaseModel):
    id: int
    image_url: str
    thumbnail_url: str
    model_config = ConfigDict(from_attributes=True)

class NewsCommentCreate(BaseModel):
    comment: str = Field(min_length=1)

class NewsComment(BaseModel):
    id: int
    user_id: int
    news_id: int
    comment: str
    created_at: datetime
    first_name: str | None = None
    last_name: str | None = None
    avatar_url: str | None = None

    model_config = ConfigDict(from_attributes=True)

class News(BaseModel):
    id: int
    title: str
    content: str
    image_url: str | None = None
    author_id: int
    moderation_status: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    images: list[NewsImage] = Field(default=[])
    likes_count: int = 0
    dislikes_count: int = 0
    comments_count: int = 0
    my_reaction: int | None = None # 1, -1 or None

    model_config = ConfigDict(from_attributes=True)
