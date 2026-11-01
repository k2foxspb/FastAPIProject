
from fastapi import APIRouter
from app.api.routers import (
    users,
    notifications,
    notification_center,
    chat,
    group_chat,
    tasks,
    admin,
    news,
    testing,
    ai,
    feed,
    journal_sync,
    journal_calendar,
    journal_attachments,
    journal_diet,
    journal_ai,
)

# Основной роутер для API v1
api_router = APIRouter()

# Роутеры, доступные без App Check (для входа, новостей и т.д.)
public_routers = [
    (users.router, ["users"]),
    (tasks.router, ["tasks"]),
    (news.router, ["news"]),
    (admin.router, ["admin"]),
    (ai.router, ["ai"]),
    (feed.router, ["feed"]),
    (notification_center.router, ["notifications"]),
    # Журнал жизни (/api/journal): данные строго личные, авторизация в каждом эндпоинте
    (journal_sync.router, ["journal"]),
    (journal_calendar.router, ["journal"]),
    (journal_attachments.router, ["journal"]),
    (journal_diet.router, ["journal"]),
    (journal_ai.router, ["journal"]),
]

for router, tags in public_routers:
    api_router.include_router(router, tags=tags)

# Регистрация без защиты App Check (для WebSockets и отладки)
# WebSockets не могут отправлять кастомные заголовки во время рукопожатия
api_router.include_router(notifications.router, tags=["websocket"])
api_router.include_router(chat.router, tags=["chat"])
api_router.include_router(group_chat.router, tags=["group_chat"])
api_router.include_router(testing.router, tags=["testing"])

__all__ = ["api_router"]