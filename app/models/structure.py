from datetime import datetime
from sqlalchemy import Boolean, Integer, String, ForeignKey, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from typing import TYPE_CHECKING
from app.database import Base

if TYPE_CHECKING:
    from app.models.users import User


class Position(Base):
    """
    Должность производственной иерархии. Не захардкожена: владелец может
    создавать новые должности и выставлять их место в иерархии через поле
    level (чем меньше значение, тем выше должность).
    """
    __tablename__ = "positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # level больше не обязан быть уникальным: на самом нижнем уровне
    # иерархии (scope="self") можно завести сколько угодно разных
    # должностей с одним и тем же level - они равноправны и не управляют
    # друг другом (см. проверку уникальности в app/api/routers/structure.py).
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    # Область ответственности: "global", "workshop", "section" или "self".
    scope: Mapped[str] = mapped_column(String(20), nullable=False, default="section")
    # Имя иконки (из набора Ionicons), которая отображается рядом с
    # должностью в админке и в профиле пользователя с этой должностью.
    icon: Mapped[str] = mapped_column(String(50), nullable=False, default="person")
    # Системные должности (сейчас - только владелец) нельзя удалить и переименовать код.
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


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
