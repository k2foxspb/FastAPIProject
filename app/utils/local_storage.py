"""
Локальное файловое хранилище с поддержкой нескольких дисков.

Этот модуль не знает ничего о бизнес-логике приложения (пользователях,
новостях, чатах и т.д.) — он реализует универсальный сервис хранения файлов
на файловой системе домашнего сервера:

    - несколько дисков (путей), заданных через .env;
    - выбор диска при сохранении (first_available / round_robin / most_free_space);
    - защита от path traversal;
    - чтение/запись/удаление файла по метаданным (diskId + relativePath);
    - fallback-поиск файла по всем дискам, если диск неизвестен.

Публичный, стабильный интерфейс для остального приложения находится в
app/utils/storage.py — он использует LocalStorageService внутри себя.
"""
import itertools
import os
import shutil
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import IO, Iterator, List, Optional

from loguru import logger

from app.utils.storage_exceptions import (
    DiskUnavailableError,
    FileNotFoundInStorageError,
    InsufficientSpaceError,
    InvalidPathError,
)

DEFAULT_CHUNK_SIZE = 64 * 1024


@dataclass
class FileMetadata:
    """
    Метаданные файла в хранилище.

    diskId и relativePath однозначно определяют расположение файла на
    файловой системе. Абсолютный путь никогда не сохраняется в БД -
    он всегда вычисляется на основе текущей конфигурации .env.
    """
    disk_id: str
    relative_path: str
    original_filename: Optional[str] = None
    mime_type: Optional[str] = None
    size: Optional[int] = None
    uploaded_at: Optional[datetime] = None

    def as_dict(self) -> dict:
        return {
            "disk_id": self.disk_id,
            "relative_path": self.relative_path,
            "original_filename": self.original_filename,
            "mime_type": self.mime_type,
            "size": self.size,
            "uploaded_at": self.uploaded_at.isoformat() if self.uploaded_at else None,
        }


def _safe_relative_path(relative_path: str) -> str:
    """
    Нормализует и проверяет относительный путь файла внутри диска хранилища.

    Запрещает:
      - абсолютные пути ("/etc/passwd", "C:\\Windows", и т.п.);
      - выход за пределы диска через "..";
      - пустые/некорректные значения.

    Возвращает безопасный относительный путь с разделителями "/".
    """
    if relative_path is None:
        raise InvalidPathError("Путь к файлу не может быть пустым")

    # Приводим к единому разделителю и убираем пробелы по краям
    normalized = relative_path.strip().replace("\\", "/")
    if not normalized:
        raise InvalidPathError("Путь к файлу не может быть пустым")

    # Запрещаем абсолютные пути (unix "/..." и windows "C:\...")
    if normalized.startswith("/") or normalized.startswith("~"):
        raise InvalidPathError(f"Недопустимый абсолютный путь: {relative_path!r}")
    if len(normalized) >= 2 and normalized[1] == ":":
        raise InvalidPathError(f"Недопустимый абсолютный путь: {relative_path!r}")

    # Разбиваем на сегменты и проверяем каждый
    parts = [p for p in normalized.split("/") if p not in ("", ".")]
    if not parts:
        raise InvalidPathError(f"Недопустимый путь: {relative_path!r}")
    for part in parts:
        if part == "..":
            raise InvalidPathError(f"Попытка выхода за пределы хранилища: {relative_path!r}")
        # NUL-байты и прочие служебные символы запрещены
        if "\x00" in part:
            raise InvalidPathError(f"Недопустимый символ в пути: {relative_path!r}")

    return "/".join(parts)


def safe_filename(filename: str) -> str:
    """
    Делает пользовательское имя файла безопасным для сохранения на диск:
    оставляет только безопасные символы, отбрасывает любые пути.
    """
    if not filename:
        return uuid.uuid4().hex
    # Берём только имя файла, отбрасывая любые директории из пользовательского ввода
    name = os.path.basename(filename.strip().replace("\\", "/"))
    name = name.replace("..", "_")
    allowed = "-_.() abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    sanitized = "".join(ch if ch in allowed else "_" for ch in name).strip(" .")
    sanitized = sanitized.replace(" ", "_")
    return sanitized or uuid.uuid4().hex


class LocalStorageService:
    """
    Сервис локального файлового хранилища с поддержкой нескольких дисков.

    disks: список абсолютных путей к корневым директориям дисков.
    strategy: "first_available" | "round_robin" | "most_free_space".
    """

    def __init__(self, disks: List[str], strategy: str = "first_available"):
        if not disks:
            raise DiskUnavailableError("Не задано ни одного диска для хранилища (STORAGE_ROOT/STORAGE_DISKS)")
        self._disk_paths = [os.path.abspath(d) for d in disks]
        self.strategy = (strategy or "first_available").lower()
        self._rr_counter = itertools.count()
        self._lock = threading.Lock()

        for path in self._disk_paths:
            try:
                os.makedirs(path, exist_ok=True)
            except OSError as e:
                logger.warning(f"Не удалось создать директорию диска хранилища {path}: {e}")

    @property
    def disk_ids(self) -> List[str]:
        return [f"disk{i}" for i in range(len(self._disk_paths))]

    def _disk_root(self, disk_id: str) -> str:
        try:
            idx = int(disk_id.replace("disk", ""))
            return self._disk_paths[idx]
        except (ValueError, IndexError):
            raise DiskUnavailableError(f"Неизвестный диск хранилища: {disk_id!r}")

    def _is_disk_available(self, disk_root: str) -> bool:
        try:
            os.makedirs(disk_root, exist_ok=True)
            return os.path.isdir(disk_root) and os.access(disk_root, os.W_OK)
        except OSError:
            return False

    def _free_bytes(self, disk_root: str) -> int:
        try:
            return shutil.disk_usage(disk_root).free
        except OSError:
            return -1

    def _select_disk(self, min_free_bytes: int = 0) -> int:
        """Выбирает индекс диска согласно стратегии. Бросает DiskUnavailableError/InsufficientSpaceError."""
        candidates = list(enumerate(self._disk_paths))
        available = [(i, p) for i, p in candidates if self._is_disk_available(p)]
        if not available:
            raise DiskUnavailableError("Ни один из дисков хранилища недоступен для записи")

        if self.strategy == "most_free_space":
            with_space = [(i, p, self._free_bytes(p)) for i, p in available]
            with_space.sort(key=lambda t: t[2], reverse=True)
            best_idx, _, best_free = with_space[0]
            if best_free >= 0 and best_free < min_free_bytes:
                raise InsufficientSpaceError(
                    f"Недостаточно свободного места на дисках хранилища (нужно минимум {min_free_bytes} байт)"
                )
            return best_idx

        if self.strategy == "round_robin":
            with self._lock:
                start = next(self._rr_counter) % len(available)
            for offset in range(len(available)):
                i, p = available[(start + offset) % len(available)]
                free = self._free_bytes(p)
                if free < 0 or free >= min_free_bytes:
                    return i
            raise InsufficientSpaceError("Недостаточно свободного места ни на одном доступном диске")

        # first_available (по умолчанию)
        for i, p in available:
            free = self._free_bytes(p)
            if free < 0 or free >= min_free_bytes:
                return i
        raise InsufficientSpaceError("Недостаточно свободного места ни на одном доступном диске")

    def _full_path(self, disk_id: str, relative_path: str) -> str:
        disk_root = self._disk_root(disk_id)
        safe_rel = _safe_relative_path(relative_path)
        full_path = os.path.abspath(os.path.join(disk_root, *safe_rel.split("/")))
        # Финальная проверка: итоговый путь обязан находиться внутри диска
        if os.path.commonpath([os.path.abspath(disk_root), full_path]) != os.path.abspath(disk_root):
            raise InvalidPathError(f"Путь выходит за пределы диска хранилища: {relative_path!r}")
        return full_path

    def save_file(
        self,
        fileobj: IO[bytes],
        relative_path: str,
        original_filename: Optional[str] = None,
        mime_type: Optional[str] = None,
        min_free_bytes: int = 0,
    ) -> FileMetadata:
        """Сохраняет файл на выбранный диск и возвращает его метаданные."""
        safe_rel = _safe_relative_path(relative_path)
        disk_idx = self._select_disk(min_free_bytes=min_free_bytes)
        disk_id = f"disk{disk_idx}"
        full_path = self._full_path(disk_id, safe_rel)

        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        tmp_path = f"{full_path}.{uuid.uuid4().hex}.tmp"
        try:
            size = 0
            with open(tmp_path, "wb") as out:
                for chunk in iter(lambda: fileobj.read(DEFAULT_CHUNK_SIZE), b""):
                    out.write(chunk)
                    size += len(chunk)
            os.replace(tmp_path, full_path)
        except OSError as e:
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except OSError:
                pass
            raise DiskUnavailableError(f"Не удалось записать файл на диск {disk_id}: {e}") from e

        return FileMetadata(
            disk_id=disk_id,
            relative_path=safe_rel,
            original_filename=original_filename,
            mime_type=mime_type,
            size=size,
            uploaded_at=datetime.now(timezone.utc),
        )

    def exists(self, metadata: FileMetadata) -> bool:
        try:
            full_path = self._full_path(metadata.disk_id, metadata.relative_path)
        except (DiskUnavailableError, InvalidPathError):
            return False
        return os.path.isfile(full_path)

    def read_file(self, metadata: FileMetadata, fallback: bool = False) -> bytes:
        """Читает файл целиком по метаданным. При fallback=True ищет файл на всех дисках."""
        try:
            full_path = self._full_path(metadata.disk_id, metadata.relative_path)
            if os.path.isfile(full_path):
                with open(full_path, "rb") as f:
                    return f.read()
        except (DiskUnavailableError, InvalidPathError):
            pass

        if fallback:
            found = self.find_by_relative_path(metadata.relative_path)
            if found is not None:
                full_path = self._full_path(found.disk_id, found.relative_path)
                with open(full_path, "rb") as f:
                    return f.read()

        raise FileNotFoundInStorageError(
            f"Файл не найден: диск={metadata.disk_id}, путь={metadata.relative_path}"
        )

    def get_file_stream(self, metadata: FileMetadata, chunk_size: int = DEFAULT_CHUNK_SIZE, fallback: bool = True) -> Iterator[bytes]:
        """Возвращает потоковый генератор чанков файла (для отдачи большого файла без загрузки в память)."""
        full_path = None
        try:
            candidate = self._full_path(metadata.disk_id, metadata.relative_path)
            if os.path.isfile(candidate):
                full_path = candidate
        except (DiskUnavailableError, InvalidPathError):
            pass

        if full_path is None and fallback:
            found = self.find_by_relative_path(metadata.relative_path)
            if found is not None:
                full_path = self._full_path(found.disk_id, found.relative_path)

        if full_path is None:
            raise FileNotFoundInStorageError(
                f"Файл не найден: диск={metadata.disk_id}, путь={metadata.relative_path}"
            )

        def _iterate():
            with open(full_path, "rb") as f:
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    yield chunk

        return _iterate()

    def delete_file(self, metadata: FileMetadata, fallback: bool = True) -> bool:
        """Удаляет файл. Возвращает True, если файл был найден и удалён."""
        try:
            full_path = self._full_path(metadata.disk_id, metadata.relative_path)
            if os.path.isfile(full_path):
                os.remove(full_path)
                return True
        except (DiskUnavailableError, InvalidPathError):
            pass

        if fallback:
            found = self.find_by_relative_path(metadata.relative_path)
            if found is not None:
                full_path = self._full_path(found.disk_id, found.relative_path)
                try:
                    os.remove(full_path)
                    return True
                except OSError as e:
                    logger.warning(f"Не удалось удалить файл {full_path}: {e}")
        return False

    def find_by_relative_path(self, relative_path: str) -> Optional[FileMetadata]:
        """Ищет файл с данным относительным путём на всех дисках (fallback при неизвестном diskId)."""
        safe_rel = _safe_relative_path(relative_path)
        for disk_id in self.disk_ids:
            try:
                full_path = self._full_path(disk_id, safe_rel)
            except (DiskUnavailableError, InvalidPathError):
                continue
            if os.path.isfile(full_path):
                return FileMetadata(disk_id=disk_id, relative_path=safe_rel)
        return None
