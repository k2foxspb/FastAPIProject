
from fastapi import APIRouter
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
)

# Основной роутер для API v1
api_router = APIRouter()

# Регистрация всех роутеров
api_router.include_router(categories.router, tags=["categories"])
api_router.include_router(products.router, tags=["products"])
api_router.include_router(users.router, tags=["users"])
api_router.include_router(reviews.router, tags=["reviews"])
api_router.include_router(cart.router, tags=["cart"])
api_router.include_router(orders.router, tags=["orders"])
api_router.include_router(payments.router, tags=["payments"])
api_router.include_router(notifications.router, tags=["websocket"])
api_router.include_router(chat.router, tags=["chat"])

__all__ = ["api_router"]