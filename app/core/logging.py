import os
import re
import sys

from loguru import logger

from app.core.config import IS_PRODUCTION

# Ключи, значения которых маскируются в сообщениях лога: key=value / key: value / "key": "value".
_SENSITIVE_KEYS = (
    "token", "access_token", "refresh_token", "password", "passwd", "authorization",
    "secret", "api_key", "apikey", "key", "otp", "code", "email", "phone", "cookie",
)
_SENSITIVE_PATTERN = re.compile(
    r"(?i)(\"?(?:%s)\"?\s*[:=]\s*)(\"[^\"]*\"|'[^']*'|[^\s,;&}]+)" % "|".join(map(re.escape, _SENSITIVE_KEYS))
)
_BEARER_PATTERN = re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._\-]+")
_JWT_PATTERN = re.compile(r"eyJ[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{5,}")
_EMAIL_PATTERN = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_PATTERN = re.compile(r"\+?\d[\d\-\s()]{9,}\d")


def mask_sensitive(text: str) -> str:
    """Маскирует токены, JWT, пароли, email и телефоны в строке лога."""
    text = _JWT_PATTERN.sub("[JWT]", text)
    text = _BEARER_PATTERN.sub(r"\1[MASKED]", text)
    text = _SENSITIVE_PATTERN.sub(lambda m: f"{m.group(1)}[MASKED]", text)
    text = _EMAIL_PATTERN.sub("[EMAIL]", text)
    return _PHONE_PATTERN.sub("[PHONE]", text)


def _mask_record(record: dict) -> bool:
    """Фильтр loguru: маскирует сообщение записи перед выводом в любой sink."""
    record["message"] = mask_sensitive(str(record["message"]))
    return True


def setup_logging() -> None:
    """Настройка логирования приложения."""

    # Удаляем дефолтный handler
    logger.remove()

    # Консольный вывод: в продакшене снижаем уровень до INFO, чтобы не засорять
    # логи отладочными сообщениями (в т.ч. потенциально чувствительными данными).
    console_level = "INFO" if IS_PRODUCTION else "DEBUG"
    logger.add(
        sys.stdout,
        level=console_level,
        filter=_mask_record,
        format="<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{module}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>"
    )

    # Файловое логирование: info.log вне публичных директорий (см. .gitignore/.dockerignore),
    # права 600 - только владелец процесса может читать журнал.
    log_path = os.getenv("LOG_FILE_PATH", "info.log")
    logger.add(
        log_path,
        level="INFO",
        filter=_mask_record,
        rotation="10 MB",
        retention="10 days",
        compression="zip",
        # Не выводим значения переменных (локалей и т.п.) и аргументы в трейсбэк.
        diagnose=not IS_PRODUCTION,
        backtrace=not IS_PRODUCTION,
    )
    try:
        if os.path.exists(log_path):
            os.chmod(log_path, 0o600)
    except OSError:
        pass
