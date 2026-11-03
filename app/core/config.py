import os
from urllib.parse import quote

from dotenv import load_dotenv
from loguru import logger

load_dotenv()

# Окружение приложения: "development" (по умолчанию) или "production".
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
IS_PRODUCTION = ENVIRONMENT == "production"

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM", "HS256")

# Значения по умолчанию и примеры из документации, которые нельзя использовать в продакшене.
WEAK_SECRET_VALUES = {"", "changeme", "secret", "password", "xxxxxxxx", "change_me", "your_secret_here"}

MAIL_USERNAME = os.getenv("MAIL_USERNAME")
MAIL_PASSWORD = os.getenv("MAIL_PASSWORD")
MAIL_FROM = os.getenv("MAIL_FROM") or MAIL_USERNAME
MAIL_PORT = int(os.getenv("MAIL_PORT", "465"))
MAIL_SERVER = os.getenv("MAIL_SERVER", "smtp.mail.ru")
MAIL_FROM_NAME = os.getenv("MAIL_FROM_NAME", "Foxly")
DOMAIN = os.getenv("DOMAIN", "https://foxlyapp.ru")
MOBILE_DEEPLINK = os.getenv("MOBILE_DEEPLINK", "foxly://verify-email")

# CORS: в продакшене по умолчанию разрешаем только реальные домены,
# в разработке - также локальные адреса. Можно переопределить через
# переменную окружения CORS_ORIGINS (список через запятую).
_cors_origins_env = os.getenv("CORS_ORIGINS")
if _cors_origins_env:
    CORS_ORIGINS = [origin.strip() for origin in _cors_origins_env.split(",") if origin.strip()]
elif IS_PRODUCTION:
    CORS_ORIGINS = [
        "https://foxlyapp.ru",
        "https://91.122.55.13",
    ]
else:
    CORS_ORIGINS = [
        "http://localhost:8081",
        "http://10.0.2.2:8081",
        "http://91.122.55.13",
        "https://91.122.55.13",
        "https://foxlyapp.ru",
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
        "91.122.55.13",
        "foxlyapp.ru",
        "fokin.fan",
        "web",  # Для внутренних запросов Docker
        "localhost",  # Для healthcheck внутри контейнера (urlopen на localhost:8000)
        "127.0.0.1",  # Для healthcheck внутри контейнера
    ]
else:
    ALLOWED_HOSTS = [
        "91.122.55.13",
        "foxlyapp.ru",
        "fokin.fan",
        "localhost",
        "127.0.0.1",
        "10.0.2.2",
        "web",  # Для внутренних запросов Docker
        "*",    # Разрешаем все хосты в режиме разработки
    ]

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = os.getenv("REDIS_PORT", "6379")
# Пароль Redis (requirepass). Пустая строка - без авторизации (только для разработки).
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")

POSTGRES_USER = os.getenv("POSTGRES_USER", "ecommerce_user")
# Дефолтного пароля нет: в продакшене значение обязательно задаётся через .env.
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "")
POSTGRES_DB = os.getenv("POSTGRES_DB", "ecommerce_db")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "db")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")

# Формируем DATABASE_URL по умолчанию (Postgres)
DEFAULT_DB_URL = f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"

# Позволяем переопределить через DATABASE_URL (например, для SQLite)
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DB_URL)

_REDIS_AUTH = f":{quote(REDIS_PASSWORD, safe='')}@" if REDIS_PASSWORD else ""
CELERY_BROKER_URL = f"redis://{_REDIS_AUTH}{REDIS_HOST}:{REDIS_PORT}/0"
CELERY_RESULT_BACKEND = f"redis://{_REDIS_AUTH}{REDIS_HOST}:{REDIS_PORT}/0"

if IS_PRODUCTION:
    _required_in_production = {
        "SECRET_KEY": SECRET_KEY,
        "SESSION_SECRET_KEY": os.getenv("SESSION_SECRET_KEY", ""),
        "POSTGRES_PASSWORD": POSTGRES_PASSWORD,
        "REDIS_PASSWORD": REDIS_PASSWORD,
    }
    _insecure = sorted(
        name for name, value in _required_in_production.items()
        if not value or value.strip().lower() in WEAK_SECRET_VALUES or len(value) < 16
    )
    if _insecure:
        raise RuntimeError(
            "В продакшене не заданы или слабые секреты (нужны случайные значения не короче 16 символов): "
            + ", ".join(_insecure)
        )

FIREBASE_SERVICE_ACCOUNT_PATH = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "firebase-service-account.json")
FIREBASE_APP_CHECK_ENFORCED = os.getenv("FIREBASE_APP_CHECK_ENFORCED", "false").lower() == "true"

if IS_PRODUCTION and not FIREBASE_APP_CHECK_ENFORCED:
    logger.warning(
        "FIREBASE_APP_CHECK_ENFORCED=false в продакшене: проверка Firebase App Check отключена."
    )

RECAPTCHA_PROJECT_ID = os.getenv("RECAPTCHA_PROJECT_ID", "")
RECAPTCHA_SITE_KEY_ANDROID = os.getenv("RECAPTCHA_SITE_KEY_ANDROID", "")
RECAPTCHA_SITE_KEY_IOS = os.getenv("RECAPTCHA_SITE_KEY_IOS", "")
RECAPTCHA_SITE_KEY_DEFAULT = os.getenv("RECAPTCHA_SITE_KEY_DEFAULT", "")
RECAPTCHA_SITE_KEY = os.getenv("RECAPTCHA_SITE_KEY", RECAPTCHA_SITE_KEY_DEFAULT)
RECAPTCHA_API_KEY = os.getenv("RECAPTCHA_API_KEY", "")

# Huawei HiLink-модем - основной провайдер SMS-кодов подтверждения.
HILINK_SMS_ENABLED = os.getenv("HILINK_SMS_ENABLED", "true").lower() == "true"
HILINK_BASE_URL = os.getenv("HILINK_BASE_URL", "http://192.168.8.1").rstrip("/")
HILINK_SMS_TIMEOUT = float(os.getenv("HILINK_SMS_TIMEOUT", "10"))

# SMS.RU/SMSC - НЕ используются по умолчанию. Это резервный способ,
# который включается только явно через SMS_FALLBACK_ENABLED=true и
# используется, только если отправка через HiLink не удалась.
SMS_FALLBACK_ENABLED = os.getenv("SMS_FALLBACK_ENABLED", "false").lower() == "true"
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

# --- Файловое хранилище (локальное, домашний сервер) ---
# STORAGE_DRIVER зарезервирован на будущее (сейчас поддерживается только "local").
STORAGE_DRIVER = os.getenv("STORAGE_DRIVER", "local").lower()

# Базовый путь к хранилищу "по умолчанию" (используется, если STORAGE_DISKS не задан).
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STORAGE_ROOT = os.getenv("STORAGE_ROOT") or os.getenv("MEDIA_ROOT") or os.path.join(_project_root, "media")

# Список путей к нескольким дискам хранилища через запятую, например:
# STORAGE_DISKS=/mnt/disk1,/mnt/disk2,/mnt/disk3
# Если не задан - используется единственный диск STORAGE_ROOT.
_storage_disks_env = os.getenv("STORAGE_DISKS")
if _storage_disks_env:
    STORAGE_DISKS = [p.strip() for p in _storage_disks_env.split(",") if p.strip()]
else:
    STORAGE_DISKS = [STORAGE_ROOT]

# Стратегия выбора диска при сохранении файла:
# first_available (по умолчанию) | round_robin | most_free_space
STORAGE_STRATEGY = os.getenv("STORAGE_STRATEGY", "first_available").lower()

# Приватные файлы (чаты) отдаются через nginx X-Accel-Redirect (в продакшене за nginx).
# В разработке (без nginx) файл отдаётся самим приложением, подпись проверяется в обоих случаях.
STORAGE_ACCEL_REDIRECT = os.getenv("STORAGE_ACCEL_REDIRECT", "true" if IS_PRODUCTION else "false").lower() == "true"

# --- Локальный ИИ (Ollama) ---
# Backend обращается к Ollama напрямую (внутри того же сервера/контейнера),
# мобильное приложение НИКОГДА не ходит в Ollama само - только через
# backend-эндпоинт POST /api/ai/chat.
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b-instruct")

# --- Журнал жизни (/api/journal) ---
# Часовой пояс журнала по умолчанию (IANA), пока пользователь не задал свой.
JOURNAL_DEFAULT_TIMEZONE = os.getenv("JOURNAL_DEFAULT_TIMEZONE", "Europe/Moscow")
# Синхронизация: максимум изменений и байт в одной пачке push, размер страницы pull.
JOURNAL_SYNC_MAX_CHANGES = int(os.getenv("JOURNAL_SYNC_MAX_CHANGES", "500"))
JOURNAL_SYNC_MAX_BYTES = int(os.getenv("JOURNAL_SYNC_MAX_BYTES", str(2 * 1024 * 1024)))
JOURNAL_SYNC_PULL_MAX_LIMIT = int(os.getenv("JOURNAL_SYNC_PULL_MAX_LIMIT", "1000"))
# Сколько дней хранятся tombstones (мягко удалённые записи) до физического удаления.
JOURNAL_TOMBSTONE_TTL_DAYS = int(os.getenv("JOURNAL_TOMBSTONE_TTL_DAYS", "180"))
# Вложения (фото к записям).
JOURNAL_ATTACHMENT_MAX_BYTES = int(os.getenv("JOURNAL_ATTACHMENT_MAX_BYTES", str(15 * 1024 * 1024)))
JOURNAL_ATTACHMENT_MIME_TYPES = ("image/jpeg", "image/png", "image/heic", "image/heif", "image/webp")
# Импорт банковских выписок.
JOURNAL_IMPORT_MAX_BYTES = int(os.getenv("JOURNAL_IMPORT_MAX_BYTES", str(10 * 1024 * 1024)))
JOURNAL_IMPORT_MAX_ROWS = int(os.getenv("JOURNAL_IMPORT_MAX_ROWS", "50000"))
JOURNAL_IMPORT_PARSE_TIMEOUT = float(os.getenv("JOURNAL_IMPORT_PARSE_TIMEOUT", "20"))
# Ограничения частоты запросов (на пользователя в час).
JOURNAL_AI_RATE_LIMIT_PER_HOUR = int(os.getenv("JOURNAL_AI_RATE_LIMIT_PER_HOUR", "30"))
JOURNAL_IMPORT_RATE_LIMIT_PER_HOUR = int(os.getenv("JOURNAL_IMPORT_RATE_LIMIT_PER_HOUR", "20"))
JOURNAL_UPLOAD_RATE_LIMIT_PER_HOUR = int(os.getenv("JOURNAL_UPLOAD_RATE_LIMIT_PER_HOUR", "300"))


