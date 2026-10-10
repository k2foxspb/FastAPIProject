from datetime import datetime
from sqlalchemy import Integer, String, ForeignKey, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from typing import TYPE_CHECKING
from app.database import Base

if TYPE_CHECKING:
    from app.models.users import User


class Workshop(Base):
    """Цех производства."""
    __tablename__ = "workshops"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    sections: Mapped[list["Section"]] = relationship(
        "Section", back_populates="workshop", cascade="all, delete-orphan"
    )
    employees: Mapped[list["User"]] = relationship(
        "User", back_populates="workshop", foreign_keys="[User.workshop_id]"
    )


class Section(Base):
    """Участок внутри цеха."""
    __tablename__ = "sections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workshop_id: Mapped[int] = mapped_column(ForeignKey("workshops.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    workshop: Mapped["Workshop"] = relationship("Workshop", back_populates="sections")
    employees: Mapped[list["User"]] = relationship(
        "User", back_populates="section", foreign_keys="[User.section_id]"
    )
