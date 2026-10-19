
from fastapi import APIRouter
from app.api.routers import (
    users,
    notifications,
    chat,
    group_chat,
    tasks,
    admin,
    news,
    testing,
    structure,
    announcements,
    timesheet,
    statements,
    ai,
    acting,
)

# Основной роутер для API v1
api_router = APIRouter()

# Роутеры, доступные без App Check (для входа, новостей и т.д.)
public_routers = [
    (users.router, ["users"]),
    (tasks.router, ["tasks"]),
    (news.router, ["news"]),
    (admin.router, ["admin"]),
    (structure.router, ["organization"]),
    (announcements.router, ["announcements"]),
    (timesheet.router, ["timesheet"]),
    (statements.router, ["statements"]),
    (ai.router, ["ai"]),
    (acting.router, ["acting"]),
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