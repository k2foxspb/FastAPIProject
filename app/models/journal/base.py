"""
Общие части моделей модуля «Журнал жизни».

Каждая синхронизируемая сущность журнала получает от миксина:
  - внутренний BigInteger-ключ `id` (только для FK внутри БД, наружу не отдаётся);
  - `user_id` владельца (все запросы фильтруются по нему);
  - `client_uuid` - идентификатор, созданный на клиенте (уникален в паре с user_id);
  - `created_at` / `updated_at` / `deleted_at` (мягкое удаление, tombstone для sync);
  - `server_rev` - монотонный номер ревизии пользователя (курсор sync pull).
"""
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

# BIGINT-первичный ключ; в SQLite автоинкремент работает только у INTEGER PRIMARY KEY.
BigIntPK = BigInteger().with_variant(Integer, "sqlite")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def entity_table_args(table_name: str, *extra):
    """Ограничения, общие для всех сущностей журнала, + дополнительные для конкретной таблицы."""
    return (
        UniqueConstraint("user_id", "client_uuid", name=f"uq_{table_name}_user_uuid"),
        Index(f"ix_{table_name}_user_rev", "user_id", "server_rev"),
        *extra,
    )


class JournalEntityMixin:
    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)

    @declared_attr
    def user_id(cls) -> Mapped[int]:
        return mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    client_uuid: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    server_rev: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
