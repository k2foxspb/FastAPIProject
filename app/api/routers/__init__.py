
from fastapi import APIRouter, Depends
from app.core.app_check import verify_app_check
from app.api.routers import (
    categories,
    products,
    users,
    reviews,
    cart,
    orders,
    payments,
    notifications,
    chat,
    tasks,
    admin,
    news,
    testing,
)

# Основной роутер для API v1
api_router = APIRouter()

# Роутеры, доступные без App Check (для входа, новостей и т.д.)
public_routers = [
    (users.router, ["users"]),
    (orders.router, ["orders"]),
    (payments.router, ["payments"]),
    (tasks.router, ["tasks"]),
    (news.router, ["news"]),
    (admin.router, ["admin"]),
]

# Роутеры, которые требуют защиты App Check (опционально)
protected_routers = [
    (categories.router, ["categories"]),
    (products.router, ["products"]),
    (reviews.router, ["reviews"]),
    (cart.router, ["cart"]),
]

for router, tags in public_routers:
    api_router.include_router(router, tags=tags)

for router, tags in protected_routers:
    api_router.include_router(router, tags=tags, dependencies=[Depends(verify_app_check)])

# Регистрация без защиты App Check (для WebSockets и отладки)
# WebSockets не могут отправлять кастомные заголовки во время рукопожатия
api_router.include_router(notifications.router, tags=["websocket"])
api_router.include_router(chat.router, tags=["chat"])
api_router.include_router(testing.router, tags=["testing"])

__all__ = ["api_router"]