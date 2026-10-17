"""
Исключения слоя файлового хранилища.

Используются внутренним сервисом локального хранилища (local_storage.py),
а также публичным API app/utils/storage.py. Бизнес-логика (роутеры) должна
ловить StorageError (или его подклассы), а не детали конкретной реализации.
"""


class StorageError(Exception):
    """Базовая ошибка слоя хранения файлов."""


class InvalidPathError(StorageError):
    """Некорректный или небезопасный путь (попытка path traversal и т.п.)."""


class DiskUnavailableError(StorageError):
    """Ни один диск хранилища недоступен для записи/чтения."""


class InsufficientSpaceError(StorageError):
    """На доступных дисках недостаточно свободного места для сохранения файла."""


class FileNotFoundInStorageError(StorageError):
    """Файл не найден по указанным метаданным (diskId + relativePath)."""
