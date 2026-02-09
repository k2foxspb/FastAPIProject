from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .routers import reviews, users, categories, products, cart, orders, payments

app = FastAPI(
    title="FastAPI Интернет-магазин",
    version="0.1.0",
)

app_v1 = FastAPI(
    title="FastAPI Интернет-магазин",
    version="0.2.0",
)

app.include_router(categories.router)
app.include_router(products.router)
app.include_router(users.router)
app.include_router(reviews.router)
app.include_router(cart.router)
app.include_router(orders.router)
app.include_router(payments.router)

# Корневой эндпоинт для проверки
@app.get("/")
async def root():
    """
    Корневой маршрут, подтверждающий, что API работает.
    """
    return {"message": "Добро пожаловать в API интернет-магазина!"}


app.mount("/media", StaticFiles(directory="media"), name="media")
app.mount('/v1', app_v1)