"""
Вложения журнала (фото к записям дневника, значениям трекеров, событиям).

Файлы сохраняются через общий слой хранения (app.utils.storage) в категорию
journal/u<user_id>/ и отдаются только владельцу через
GET /api/journal/attachments/{uuid}/file (путь /media/journal/... закрыт).
Загрузка идемпотентна по client_uuid - клиент может безопасно повторять её.
"""
import io
import mimetypes
from dataclasses import dataclass

from fastapi import UploadFile
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config
from app.models.journal import JournalAttachment
from app.models.journal.base import utcnow
from app.services.journal.sync_registry import ATTACHMENT_OWNER_TYPES, REGISTRY
from app.services.journal.sync_service import SyncError, find_alive, lock_state, next_rev
from app.utils import storage as storage_service

STORAGE_CATEGORY = "journal"
_EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
               "image/heic": ".heic", "image/heif": ".heif"}
_HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis"}
_HEIF_GENERIC_BRANDS = {b"mif1", b"msf1"}


def detect_image_mime(head: bytes) -> str | None:
    """Определяет тип изображения по сигнатуре (не доверяем Content-Type клиента)."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if len(head) >= 12 and head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in _HEIF_BRANDS:
            return "image/heic"
        if brand in _HEIF_GENERIC_BRANDS:
            return "image/heif"
    return None


async def read_limited(upload: UploadFile, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise SyncError(413, f"Файл больше {max_bytes // (1024 * 1024)} МБ")
        chunks.append(chunk)
    return b"".join(chunks)


def _image_size(content: bytes) -> tuple[int | None, int | None]:
    try:
        from PIL import Image
        with Image.open(io.BytesIO(content)) as img:
            return img.width, img.height
    except Exception:
        return None, None


def category_for(user_id: int) -> str:
    return f"{STORAGE_CATEGORY}/u{user_id}"


@dataclass
class UploadResult:
    attachment: JournalAttachment
    created: bool


async def create_attachment(db: AsyncSession, user_id: int, client_uuid: str, owner_type: str,
                            owner_uuid: str, upload: UploadFile) -> UploadResult:
    if owner_type not in ATTACHMENT_OWNER_TYPES:
        raise SyncError(422, "Недопустимый тип записи для вложения")

    existing = (await db.execute(
        select(JournalAttachment).where(
            JournalAttachment.user_id == user_id,
            JournalAttachment.client_uuid == client_uuid,
        )
    )).scalar_one_or_none()
    if existing is not None:
        if existing.deleted_at is not None:
            raise SyncError(409, "Вложение уже удалено")
        if existing.owner_type != owner_type or existing.owner_uuid != owner_uuid:
            raise SyncError(409, "Вложение с таким идентификатором привязано к другой записи")
        return UploadResult(existing, created=False)

    owner = await find_alive(db, REGISTRY[ATTACHMENT_OWNER_TYPES[owner_type]].model, user_id, owner_uuid)
    if owner is None:
        # Запись ещё не доехала через sync (или чужая) - клиент повторит позже
        raise SyncError(409, "owner_not_synced")

    content = await read_limited(upload, config.JOURNAL_ATTACHMENT_MAX_BYTES)
    if not content:
        raise SyncError(422, "Пустой файл")
    mime = detect_image_mime(content[:32])
    if mime is None or mime not in config.JOURNAL_ATTACHMENT_MIME_TYPES:
        raise SyncError(415, "Поддерживаются только изображения JPEG, PNG, HEIC и WebP")
    width, height = _image_size(content)

    try:
        _, key = storage_service.save_file(
            category_for(user_id), f"{client_uuid}{_EXTENSIONS[mime]}", io.BytesIO(content), mime
        )
    except storage_service.StorageError as e:
        logger.warning(f"Journal: не удалось сохранить вложение пользователя {user_id}: {type(e).__name__}")
        raise SyncError(503, "Хранилище временно недоступно")

    # Слой хранения может пережать изображение в JPEG - тип берём по итоговому имени
    stored_mime = mimetypes.guess_type(key.partition(":")[2] or key)[0] or mime

    state = await lock_state(db, user_id)
    now = utcnow()
    attachment = JournalAttachment(
        user_id=user_id,
        client_uuid=client_uuid,
        owner_type=owner_type,
        owner_uuid=owner_uuid,
        storage_key=key,
        mime=stored_mime,
        size_bytes=len(content),
        width=width,
        height=height,
        created_at=now,
        updated_at=now,
        server_rev=next_rev(state),
    )
    db.add(attachment)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        storage_service.delete(STORAGE_CATEGORY, key)
        raise
    return UploadResult(attachment, created=True)


async def get_owned_attachment(db: AsyncSession, user_id: int, client_uuid: str) -> JournalAttachment | None:
    """Вложение текущего пользователя (чужое или удалённое -> None, без различия причин)."""
    return await find_alive(db, JournalAttachment, user_id, client_uuid)
