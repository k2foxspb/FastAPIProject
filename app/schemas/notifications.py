from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


class NotificationActorInfo(BaseModel):
    id: int
    first_name: str | None = None
    last_name: str | None = None
    avatar_url: str | None = None

    model_config = ConfigDict(from_attributes=True)


class NotificationResponse(BaseModel):
    id: int
    notif_type: str
    title: str
    body: str | None = None
    data: Optional[dict[str, Any]] = None
    count: int = 1
    is_read: bool = False
    is_unremovable: bool = False
    created_at: datetime
    updated_at: datetime
    actor: Optional[NotificationActorInfo] = None

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def model_validate(cls, obj, **kwargs):
        if isinstance(obj, dict):
            return super().model_validate(obj, **kwargs)

        actor = None
        actor_obj = getattr(obj, "actor", None)
        if actor_obj is not None:
            actor = NotificationActorInfo.model_validate(actor_obj)

        return cls(
            id=obj.id,
            notif_type=obj.notif_type,
            title=obj.title,
            body=obj.body,
            data=obj.data,
            count=obj.count,
            is_read=obj.is_read,
            is_unremovable=obj.is_unremovable,
            created_at=obj.created_at,
            updated_at=obj.updated_at,
            actor=actor,
        )


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    unread_count: int
