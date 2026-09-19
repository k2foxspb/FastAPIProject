import os

from dotenv import load_dotenv
from loguru import logger

load_dotenv()

# Окружение приложения: "development" (по умолчанию) или "production".
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
IS_PRODUCTION = ENVIRONMENT == "production"

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM", "HS256")

if IS_PRODUCTION and not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY должен быть задан через переменную окружения в продакшене."
    )

YOOKASSA_SHOP_ID = os.getenv("YOOKASSA_SHOP_ID")
YOOKASSA_SECRET_KEY = os.getenv("YOOKASSA_SECRET_KEY")
YOOKASSA_RETURN_URL = os.getenv("YOOKASSA_RETURN_URL", "http://79.133.183.129/")

MAIL_USERNAME = os.getenv("MAIL_USERNAME")
MAIL_PASSWORD = os.getenv("MAIL_PASSWORD")
MAIL_FROM = os.getenv("MAIL_FROM") or MAIL_USERNAME
MAIL_PORT = int(os.getenv("MAIL_PORT", "465"))
MAIL_SERVER = os.getenv("MAIL_SERVER", "smtp.mail.ru")
MAIL_FROM_NAME = os.getenv("MAIL_FROM_NAME", "FokinFun")
DOMAIN = os.getenv("DOMAIN", "https://fokin.fun")
MOBILE_DEEPLINK = os.getenv("MOBILE_DEEPLINK", "fokinfun://verify-email")

# CORS: в продакшене по умолчанию разрешаем только реальные домены,
# в разработке - также локальные адреса. Можно переопределить через
# переменную окружения CORS_ORIGINS (список через запятую).
_cors_origins_env = os.getenv("CORS_ORIGINS")
if _cors_origins_env:
    CORS_ORIGINS = [origin.strip() for origin in _cors_origins_env.split(",") if origin.strip()]
elif IS_PRODUCTION:
    CORS_ORIGINS = [
        "https://fokin.fun",
        "https://79.133.183.129",
    ]
else:
    CORS_ORIGINS = [
        "http://localhost:8081",
        "http://10.0.2.2:8081",
        "http://79.133.183.129",
        "https://79.133.183.129",
        "https://fokin.fun",
        "http://fokin.fan",
        "http://localhost",
        "http://localhost:3000",
        "http://127.0.0.1",
        "http://127.0.0.1:3000",
        "http://10.0.2.2:8000",
    ]

# Allowed hosts: в продакшене НЕЛЬЗЯ использовать wildcard "*",
# чтобы TrustedHostMiddleware реально защищал от Host header атак.
# Можно переопределить через переменную окружения ALLOWED_HOSTS (список через запятую).
_allowed_hosts_env = os.getenv("ALLOWED_HOSTS")
if _allowed_hosts_env:
    ALLOWED_HOSTS = [host.strip() for host in _allowed_hosts_env.split(",") if host.strip()]
elif IS_PRODUCTION:
    ALLOWED_HOSTS = [
        "79.133.183.129",
        "fokin.fun",
        "fokin.fan",
        "web",  # Для внутренних запросов Docker
    ]
else:
    ALLOWED_HOSTS = [
        "79.133.183.129",
        "fokin.fun",
        "fokin.fan",
        "localhost",
        "127.0.0.1",
        "10.0.2.2",
        "web",  # Для внутренних запросов Docker
        "*",    # Разрешаем все хосты в режиме разработки
    ]

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = os.getenv("REDIS_PORT", "6379")

POSTGRES_USER = os.getenv("POSTGRES_USER", "ecommerce_user")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "xxxxxxxx")
POSTGRES_DB = os.getenv("POSTGRES_DB", "ecommerce_db")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "db")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")

# Формируем DATABASE_URL по умолчанию (Postgres)
DEFAULT_DB_URL = f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"

# Позволяем переопределить через DATABASE_URL (например, для SQLite)
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DB_URL)

CELERY_BROKER_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}/0"
CELERY_RESULT_BACKEND = f"redis://{REDIS_HOST}:{REDIS_PORT}/0"

FIREBASE_SERVICE_ACCOUNT_PATH = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "firebase-service-account.json")
FIREBASE_APP_CHECK_ENFORCED = os.getenv("FIREBASE_APP_CHECK_ENFORCED", "false").lower() == "true"

if IS_PRODUCTION and not FIREBASE_APP_CHECK_ENFORCED:
    logger.warning(
        "FIREBASE_APP_CHECK_ENFORCED=false в продакшене: проверка Firebase App Check отключена."
    )

RECAPTCHA_PROJECT_ID = os.getenv("RECAPTCHA_PROJECT_ID", "fastapi-f628e")
RECAPTCHA_SITE_KEY_ANDROID = os.getenv("RECAPTCHA_SITE_KEY_ANDROID", "")
RECAPTCHA_SITE_KEY_IOS = os.getenv("RECAPTCHA_SITE_KEY_IOS", "")
RECAPTCHA_SITE_KEY_DEFAULT = os.getenv("RECAPTCHA_SITE_KEY_DEFAULT", "")
RECAPTCHA_SITE_KEY = os.getenv("RECAPTCHA_SITE_KEY", RECAPTCHA_SITE_KEY_DEFAULT)
RECAPTCHA_API_KEY = os.getenv("RECAPTCHA_API_KEY", "")

SMS_RU_API_KEY = os.getenv("SMS_RU_API_KEY")
SMS_CENTER_LOGIN = os.getenv("SMS_CENTER_LOGIN")
SMS_CENTER_PASSWORD = os.getenv("SMS_CENTER_PASSWORD")

# Секрет для подписи сессионной куки (Starlette SessionMiddleware).
# В продакшене обязателен и не должен иметь предсказуемого значения по умолчанию.
_DEV_SESSION_SECRET_KEY = "7UzGQS7woBazLUtVQJG39ywOP7J7lkPkB0UmDhMgBR8="
SESSION_SECRET_KEY = os.getenv("SESSION_SECRET_KEY")
if IS_PRODUCTION and not SESSION_SECRET_KEY:
    raise RuntimeError(
        "SESSION_SECRET_KEY должен быть задан через переменную окружения в продакшене."
    )
if not SESSION_SECRET_KEY:
    SESSION_SECRET_KEY = _DEV_SESSION_SECRET_KEY

# Кука сессии должна отправляться только по HTTPS в продакшене.
SESSION_HTTPS_ONLY = IS_PRODUCTION

# Документация API (Swagger/ReDoc) отключается в продакшене, если явно не разрешена.
ENABLE_API_DOCS = os.getenv("ENABLE_API_DOCS", "false" if IS_PRODUCTION else "true").lower() == "true"


