import os

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from loguru import logger

from app.core.config import IS_PRODUCTION

CHAT_ENCRYPTION_KEY = os.getenv("CHAT_ENCRYPTION_KEY", "")
# Старые ключи для расшифровки после ротации (через запятую). Новым ключом всегда шифруется первый.
CHAT_ENCRYPTION_KEYS_OLD = [
    k.strip() for k in os.getenv("CHAT_ENCRYPTION_KEYS_OLD", "").split(",") if k.strip()
]

if not CHAT_ENCRYPTION_KEY:
    if IS_PRODUCTION:
        raise RuntimeError("CHAT_ENCRYPTION_KEY должен быть задан в .env в продакшене.")
    CHAT_ENCRYPTION_KEY = Fernet.generate_key().decode()
    logger.warning("CHAT_ENCRYPTION_KEY не задан: используется временный ключ, сообщения не будут читаться после перезапуска.")

_fernet = MultiFernet(
    [Fernet(k.encode()) for k in [CHAT_ENCRYPTION_KEY, *CHAT_ENCRYPTION_KEYS_OLD]]
)

_ENC_PREFIX = "enc:"


def is_encrypted(value):
    return value is not None and value.startswith(_ENC_PREFIX)


def encrypt_text(value):
    if value is None:
        return None
    return _ENC_PREFIX + _fernet.encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_text(value):
    if not is_encrypted(value):
        return value
    try:
        return _fernet.decrypt(value[len(_ENC_PREFIX):].encode("ascii")).decode("utf-8")
    except InvalidToken:
        logger.error("Не удалось расшифровать сообщение чата: неверный CHAT_ENCRYPTION_KEY или повреждённые данные")
        return None
