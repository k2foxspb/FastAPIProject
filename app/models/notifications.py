from datetime import datetime
from sqlalchemy import Boolean, Integer, String, ForeignKey, DateTime, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Notification(Base):
    """
    Уведомление пользователя, которое отображается в колокольчике уведомлений
    (всё, кроме сообщений чата - чатовые уведомления остаются только в разделе
    сообщений и не попадают в эту таблицу).

    notif_type:
        "post_like"       - лайк поста;
        "post_comment"    - комментарий к посту;
        "friend_request"  - заявка в друзья;
        "friend_accepted" - заявка в друзья принята;
        "friend_post"     - новый пост друга;
        "post_moderated"  - пост отмечен как проверенный модератором;
        "announcement"    - объявление администратора/владельца;
        "system"          - системное уведомление.
    """
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    notif_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(String, nullable=True)
    # Группировка однотипных уведомлений об одном и том же объекте
    # (например "post_like:post:123"), чтобы не плодить по одной записи на
    # каждый лайк - при повторном событии обновляем существующую запись.
    group_key: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    # Произвольные данные для перехода к связанному объекту, например
    # {"object_type": "profile_post", "object_id": 123}
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    count: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    is_unremovable: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
    actor: Mapped["User | None"] = relationship("User", foreign_keys=[actor_id])
