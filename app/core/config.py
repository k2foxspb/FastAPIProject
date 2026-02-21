import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
SECRET_KEY = os.getenv("SECRET_KEY", "ksdjfksdf")
ALGORITHM = os.getenv("ALGORITHM", "HS256")

YOOKASSA_SHOP_ID = os.getenv("YOOKASSA_SHOP_ID")
YOOKASSA_SECRET_KEY = os.getenv("YOOKASSA_SECRET_KEY")
YOOKASSA_RETURN_URL = os.getenv("YOOKASSA_RETURN_URL", "http://79.133.183.129/")

MAIL_USERNAME = os.getenv("MAIL_USERNAME")
MAIL_PASSWORD = os.getenv("MAIL_PASSWORD")
MAIL_FROM = os.getenv("MAIL_FROM")
MAIL_PORT = int(os.getenv("MAIL_PORT", "587"))
MAIL_SERVER = os.getenv("MAIL_SERVER")
MAIL_FROM_NAME = os.getenv("MAIL_FROM_NAME", "FastAPI Project")
DOMAIN = os.getenv("DOMAIN", "http://79.133.183.129")

# Базовый deeplink мобильного приложения, например: "myapp://verify-email"
# Если не задан, бэкенд не будет выполнять редирект по умолчанию.
MOBILE_DEEPLINK = os.getenv("MOBILE_DEEPLINK", "fokinfun://verify-email")

CORS_ORIGINS = [
    "http://79.133.183.129",
    "https://79.133.183.129",
    "http://fokin.fun",
    "https://fokin.fun",
    "http://fokin.fan",
    "https://fokin.fan",
    "http://localhost",
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://127.0.0.1:3000",
]
ALLOWED_HOSTS = [
    "79.133.183.129",
    "fokin.fun",
    "fokin.fan",
    "localhost",
    "127.0.0.1",
    "web",  # Для внутренних запросов Docker
    "*",    # Разрешаем все хосты временно для отладки, если TrustedHostMiddleware мешает
]
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = os.getenv("REDIS_PORT", "6379")

POSTGRES_USER = os.getenv("POSTGRES_USER", "ecommerce_user")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "xxxxxxxx")
POSTGRES_DB = os.getenv("POSTGRES_DB", "ecommerce_db")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "db")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")

DATABASE_URL = f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"

CELERY_BROKER_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}/0"
CELERY_RESULT_BACKEND = f"redis://{REDIS_HOST}:{REDIS_PORT}/0"

FIREBASE_SERVICE_ACCOUNT_PATH = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "firebase-service-account.json")


