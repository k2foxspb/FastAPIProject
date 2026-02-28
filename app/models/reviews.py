import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Integer, String, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
if TYPE_CHECKING:
    from app.models.users import User
    from app.models.products import Product


class Reviews(Base):
    __tablename__ = 'reviews'


    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    comment: Mapped[str] = mapped_column(String,nullable=True)
    comment_date: Mapped[datetime.datetime] = mapped_column(DateTime)
    grade: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))

    user: Mapped["User"] = relationship("User", back_populates="reviews")
    product: Mapped["Product"] = relationship("Product", back_populates="review")
    reactions: Mapped[list["ReviewReaction"]] = relationship("ReviewReaction", back_populates="review", cascade="all, delete-orphan")

class ReviewReaction(Base):
    __tablename__ = "review_reactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    review_id: Mapped[int] = mapped_column(ForeignKey("reviews.id", ondelete="CASCADE"), nullable=False)
    reaction_type: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 for like, -1 for dislike

    user: Mapped["User"] = relationship("User")
    review: Mapped["Reviews"] = relationship("Reviews", back_populates="reactions")