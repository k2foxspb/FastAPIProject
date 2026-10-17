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
import os
from typing import IO, Iterator, Optional, Tuple
from datetime import datetime

from loguru import logger

from app.core import config
from app.utils.local_storage import FileMetadata, LocalStorageService, safe_filename
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
    "save_file",
    "delete",
    "read_file",
    "get_file_stream",
    "exists",
    "resolve_url",
]

MEDIA_URL_PREFIX = "/media/"

# Единственный экземпляр сервиса хранения на процесс (переиспользуется между запросами).
_service = LocalStorageService(disks=config.STORAGE_DISKS, strategy=config.STORAGE_STRATEGY)


def _timestamped_name(filename_hint: str) -> str:
    base = safe_filename(filename_hint) or "file"
    ts = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    return f"{ts}_{base}"


def build_key(category: str, filename_hint: str) -> str:
    """Строит относительный путь файла внутри хранилища (category/имя_с_таймстампом)."""
    name = _timestamped_name(filename_hint)
    category = (category or "misc").strip("/")
    return f"{category}/{name}"


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

    if url_or_key.startswith(("http://", "https://", "s3://")):
        # Внешняя ссылка - локально такого файла нет.
        return None

    decoded = _decode_key(url_or_key)
    if decoded is not None:
        return decoded

    rel_path = url_or_key
    if rel_path.startswith(MEDIA_URL_PREFIX):
        rel_path = rel_path[len(MEDIA_URL_PREFIX):]
    rel_path = rel_path.lstrip("/")

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

    url = f"{MEDIA_URL_PREFIX}{metadata.relative_path}"
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
