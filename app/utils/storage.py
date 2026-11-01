"""
Публичный API слоя хранения файлов.

Это единственная точка входа, которую должна использовать бизнес-логика
приложения (роутеры и т.д.) для работы с файлами. Конкретная реализация
хранилища (локальная файловая система с одним или несколькими дисками)
полностью инкапсулирована в app.utils.local_storage.LocalStorageService -
остальная часть приложения ничего не знает о дисках, путях или стратегиях
выбора диска.

Файлы хранятся локально на дисках домашнего сервера, настраиваемых через
переменные окружения STORAGE_ROOT / STORAGE_DISKS / STORAGE_STRATEGY
(см. app/core/config.py и .env.example).

Публичный интерфейс:
    save_file(category, filename_hint, fileobj, content_type=None, private=False) -> (url, key)
    delete(category, key_or_path) -> None
    read_file(file_metadata) -> bytes
    get_file_stream(file_metadata) -> Iterator[bytes]
    exists(file_metadata) -> bool
    resolve_url(url_or_key) -> FileMetadata | None
"""
import hashlib
import hmac
import os
import posixpath
import re
import unicodedata
import uuid
from typing import IO, Any, Iterator, Optional, Tuple
from urllib.parse import quote, unquote

from loguru import logger

from app.core import config
from app.utils.local_storage import FileMetadata, LocalStorageService
from app.utils.media_processing import (
    IMAGE_CONTENT_TYPES,
    VIDEO_CONTENT_TYPES,
    compress_image,
    compress_video,
)
from app.utils.storage_exceptions import (
    DiskUnavailableError,
    FileNotFoundInStorageError,
    InsufficientSpaceError,
    InvalidPathError,
    StorageError,
)

__all__ = [
    "IMAGE_CONTENT_TYPES",
    "VIDEO_CONTENT_TYPES",
    "compress_image",
    "compress_video",
    "StorageError",
    "DiskUnavailableError",
    "FileNotFoundInStorageError",
    "InsufficientSpaceError",
    "InvalidPathError",
    "FileMetadata",
    "build_key",
    "user_folder_name",
    "user_media_category",
    "chat_media_category",
    "save_file",
    "delete",
    "read_file",
    "get_file_stream",
    "exists",
    "resolve_url",
    "is_private_relative_path",
    "sign_media_path",
    "verify_media_signature",
    "PROTECTED_MEDIA_PREFIX",
]

MEDIA_URL_PREFIX = "/media/"
# Внутренний префикс nginx (location internal), куда приложение отдаёт приватные файлы через X-Accel-Redirect.
PROTECTED_MEDIA_PREFIX = "/protected_media/"
# Верхний уровень папок, которые считаются приватными (файлы чатов и журнал).
_PRIVATE_TOP_LEVEL = ("chat", "journal")

# Единственный экземпляр сервиса хранения на процесс (переиспользуется между запросами).
_service = LocalStorageService(disks=config.STORAGE_DISKS, strategy=config.STORAGE_STRATEGY)


def _random_name(filename_hint: str) -> str:
    """
    Случайное имя файла (uuid4) с сохранённым расширением. Оригинальное имя
    не попадает в URL - его можно хранить только в БД.
    """
    suffix = "".join(
        ch for ch in os.path.splitext(filename_hint or "")[1].lower() if ch.isascii() and ch.isalnum()
    )[:10]
    return f"{uuid.uuid4().hex}.{suffix}" if suffix else uuid.uuid4().hex


def build_key(category: str, filename_hint: str) -> str:
    """Строит относительный путь файла внутри хранилища (category/случайное_имя.ext)."""
    name = _random_name(filename_hint)
    category = (category or "misc").strip("/")
    return f"{category}/{name}"


# Разделитель имён двух собеседников в названии папки личного чата: "Иван_Иванов__Пётр_Петров".
CHAT_FOLDER_SEPARATOR = "__"
_FOLDER_ALLOWED_EXTRA = "-_.()"
_FOLDER_MAX_LEN = 100


def _safe_folder_name(value: Optional[str]) -> str:
    """
    Делает произвольную строку (имя, фамилию, название группы) безопасным именем папки.
    Разрешены буквы любых алфавитов (в т.ч. кириллица), цифры и символы "-_.()";
    всё остальное (пробелы, слэши, "..", "%" и т.п.) заменяется на "_".
    """
    if not value:
        return ""
    value = unicodedata.normalize("NFC", str(value)).strip()
    sanitized = "".join(ch if (ch.isalnum() or ch in _FOLDER_ALLOWED_EXTRA) else "_" for ch in value)
    sanitized = sanitized.replace("..", "_")
    sanitized = re.sub(r"_+", "_", sanitized).strip("._ ")
    return sanitized[:_FOLDER_MAX_LEN].strip("._ ")


def user_folder_name(user: Any) -> str:
    """
    Имя папки пользователя в хранилище: "Имя_Фамилия" (например "Иван_Иванов").
    Если имя и фамилия не заполнены, используется "user_<id>", чтобы файлы не
    попадали в общую безымянную папку.
    """
    first_name = getattr(user, "first_name", None) or ""
    last_name = getattr(user, "last_name", None) or ""
    name = _safe_folder_name(f"{first_name} {last_name}")
    if name:
        return name
    user_id = getattr(user, "id", None) if not isinstance(user, int) else user
    return f"user_{user_id}" if user_id is not None else "unknown"


def user_media_category(user: Any, section: str) -> str:
    """
    Возвращает категорию (папку) файлов пользователя: users/<Имя_Фамилия>/<раздел>,
    например users/Иван_Иванов/albums.
    """
    section = (section or "misc").strip("/")
    return f"users/{user_folder_name(user)}/{section}"


def chat_media_category(owner: Any, partner: Any = None, group_name: Optional[str] = None) -> str:
    """
    Возвращает папку файлов чата внутри папки пользователя-отправителя:
      - личный чат:  users/<Имя_Фамилия>/chats/<Имя_Фамилия>__<Имя_Фамилия собеседника>;
      - групповой:   users/<Имя_Фамилия>/chats/<Название_группы>;
      - чат неизвестен: users/<Имя_Фамилия>/chats.
    """
    base = user_media_category(owner, "chats")
    if partner is not None:
        return f"{base}/{user_folder_name(owner)}{CHAT_FOLDER_SEPARATOR}{user_folder_name(partner)}"
    group_folder = _safe_folder_name(group_name)
    if group_folder:
        return f"{base}/{group_folder}"
    return base


def _normalize_relative(relative_path: str) -> str:
    return posixpath.normpath(relative_path.replace("\\", "/")).lstrip("/")


def is_private_relative_path(relative_path: str) -> bool:
    """
    Приватные файлы: вложения чатов (users/<имя>/chats/..., chat/...).
    Публичные (аватары, посты, новости, сборки приложения) остаются открытыми.
    """
    parts = _normalize_relative(relative_path).lower().split("/")
    if parts[0] in _PRIVATE_TOP_LEVEL:
        return True
    return len(parts) >= 3 and parts[0] == "users" and parts[2] == "chats"


def _media_signing_key() -> bytes:
    return (config.SECRET_KEY or config.SESSION_SECRET_KEY).encode("utf-8")


def sign_media_path(relative_path: str) -> str:
    """HMAC-подпись относительного пути приватного файла (добавляется в URL как ?sig=...)."""
    message = b"media:" + _normalize_relative(relative_path).encode("utf-8")
    return hmac.new(_media_signing_key(), message, hashlib.sha256).hexdigest()


def verify_media_signature(relative_path: str, signature: Optional[str]) -> bool:
    if not signature:
        return False
    return hmac.compare_digest(sign_media_path(relative_path), signature)


def _encode_key(metadata: FileMetadata) -> str:
    """Кодирует diskId и relativePath в единую строку-ключ для хранения во внешнем коде (БД)."""
    return f"{metadata.disk_id}:{metadata.relative_path}"


def _decode_key(key: str) -> Optional[FileMetadata]:
    """Пытается распарсить ключ, созданный _encode_key. Возвращает None, если формат не распознан."""
    if not key or ":" not in key:
        return None
    disk_id, _, rel_path = key.partition(":")
    if disk_id in _service.disk_ids:
        return FileMetadata(disk_id=disk_id, relative_path=rel_path)
    return None


def resolve_url(url_or_key: str) -> Optional[FileMetadata]:
    """
    Находит метаданные файла по URL (/media/category/name.jpg), по новому ключу
    ("diskN:category/name.jpg") или по голому относительному пути ("category/name.jpg").
    Выполняет fallback-поиск по всем дискам. Возвращает None, если файл не найден
    или ссылка указывает на внешний ресурс.
    """
    if not url_or_key:
        return None

    # Убираем подпись (?sig=...), она не является частью пути к файлу.
    url_or_key = url_or_key.split("?", 1)[0]
    if not url_or_key:
        return None

    if url_or_key.startswith(("http://", "https://", "s3://")):
        # Внешняя ссылка - локально такого файла нет.
        return None

    decoded = _decode_key(url_or_key)
    if decoded is not None:
        return decoded

    rel_path = url_or_key
    if rel_path.startswith(MEDIA_URL_PREFIX):
        rel_path = rel_path[len(MEDIA_URL_PREFIX):]
    rel_path = unquote(rel_path.lstrip("/"))

    try:
        return _service.find_by_relative_path(rel_path)
    except InvalidPathError as e:
        logger.warning(f"Небезопасный путь при разрешении файла {url_or_key!r}: {e}")
        return None


def save_file(
    category: str,
    filename_hint: str,
    fileobj: IO[bytes],
    content_type: Optional[str] = None,
    private: bool = False,
) -> Tuple[str, str]:
    """
    Сохраняет файл в локальное хранилище (с поддержкой нескольких дисков) и
    возвращает кортеж (url, key):
      - url - путь вида "/media/category/имя_файла.ext", по которому файл
        отдаётся через HTTP (см. app/main.py);
      - key - непрозрачный ключ "diskN:category/имя_файла.ext", который можно
        сохранить в БД для последующего однозначного удаления/чтения файла.

    Изображения автоматически сжимаются перед сохранением; `private` оставлен
    для обратной совместимости сигнатуры (локальное хранилище не разделяет
    файлы по ACL - доступ ограничивается на уровне API).
    """
    fileobj, content_type = compress_image(fileobj, content_type)

    # Обновляем расширение имени файла для изображений, сохранённых как JPEG
    if content_type == "image/jpeg" and not filename_hint.lower().endswith((".jpg", ".jpeg")):
        filename_hint = os.path.splitext(filename_hint)[0] + ".jpg"

    # Сжимаем видео если применимо
    ct_check = (content_type or "").lower()
    if ct_check in VIDEO_CONTENT_TYPES:
        fileobj, content_type, filename_hint = compress_video(fileobj, content_type, filename_hint)

    relative_path = build_key(category, filename_hint)
    metadata = _service.save_file(
        fileobj,
        relative_path,
        original_filename=filename_hint,
        mime_type=content_type,
    )

    # Папки пользователей могут содержать кириллицу - отдаём URL в percent-encoding.
    url = f"{MEDIA_URL_PREFIX}{quote(metadata.relative_path, safe='/()')}"
    if is_private_relative_path(metadata.relative_path):
        url = f"{url}?sig={sign_media_path(metadata.relative_path)}"
    key = _encode_key(metadata)
    return url, key


def delete(category_or_key: str, key_or_path: str) -> None:
    """
    Удаляет файл из хранилища. Принимает как новый ключ ("diskN:category/name"),
    так и legacy-значения, которые раньше сохранялись в БД: относительный URL
    ("/media/category/name") или "голый" относительный путь. Ссылки на внешние
    ресурсы (http/s3) безопасно пропускаются - локально такого файла нет.
    """
    if not key_or_path:
        return

    if key_or_path.startswith(("http://", "https://", "s3://")):
        logger.warning(f"Удаление файла по внешней ссылке не поддерживается: {key_or_path}")
        return

    metadata = resolve_url(key_or_path)
    if metadata is None:
        logger.warning(f"Файл для удаления не найден в локальном хранилище: {key_or_path}")
        return

    try:
        deleted = _service.delete_file(metadata)
        if not deleted:
            logger.warning(f"Файл для удаления не найден на диске {metadata.disk_id}: {metadata.relative_path}")
    except StorageError as e:
        logger.warning(f"Не удалось удалить файл {key_or_path}: {e}")


def read_file(file_metadata: FileMetadata, fallback: bool = True) -> bytes:
    """Читает содержимое файла целиком по его метаданным (diskId + relativePath)."""
    return _service.read_file(file_metadata, fallback=fallback)


def get_file_stream(file_metadata: FileMetadata, fallback: bool = True) -> Iterator[bytes]:
    """Возвращает потоковый итератор по содержимому файла (для отдачи через HTTP без буферизации целиком)."""
    return _service.get_file_stream(file_metadata, fallback=fallback)


def exists(file_metadata: FileMetadata) -> bool:
    """Проверяет, существует ли файл по его метаданным."""
    return _service.exists(file_metadata)
