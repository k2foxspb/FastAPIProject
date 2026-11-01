"""Вложения «Журнала жизни»: загрузка фото и отдача файла только владельцу."""
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_async_db
from app.core import config
from app.core.auth import get_current_user
from app.core.rate_limit import rate_limit
from app.models.users import User as UserModel
from app.services.journal import attachments as attachments_service
from app.services.journal.sync_service import SyncError, json_value
from app.utils import storage as storage_service

router = APIRouter(prefix="/api/journal", tags=["journal"])

_upload_limiter = rate_limit("journal_upload", config.JOURNAL_UPLOAD_RATE_LIMIT_PER_HOUR, 3600)


def _parse_uuid(value: str) -> str | None:
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError):
        return None


def _attachment_out(att) -> dict:
    return {
        "client_uuid": att.client_uuid,
        "owner_type": att.owner_type,
        "owner_uuid": att.owner_uuid,
        "mime": att.mime,
        "size_bytes": att.size_bytes,
        "width": att.width,
        "height": att.height,
        "server_rev": att.server_rev,
        "created_at": json_value(att.created_at),
        "updated_at": json_value(att.updated_at),
    }


@router.post("/attachments")
async def upload_attachment(
    file: UploadFile = File(...),
    client_uuid: str = Form(...),
    owner_type: str = Form(...),
    owner_uuid: str = Form(...),
    current_user: UserModel = Depends(_upload_limiter),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Загружает фото к записи журнала. Повторная загрузка с тем же client_uuid
    возвращает уже сохранённое вложение (200), новая - 201.
    """
    att_uuid = _parse_uuid(client_uuid)
    own_uuid = _parse_uuid(owner_uuid)
    if att_uuid is None or own_uuid is None:
        raise HTTPException(status_code=422, detail="Некорректный UUID")
    try:
        result = await attachments_service.create_attachment(
            db, current_user.id, att_uuid, owner_type, own_uuid, file
        )
    except SyncError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    return JSONResponse(status_code=201 if result.created else 200, content=_attachment_out(result.attachment))


@router.get("/attachments/{attachment_uuid}/file")
async def download_attachment(
    attachment_uuid: str,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Отдаёт файл вложения. Чужое, удалённое или несуществующее вложение - 404."""
    att_uuid = _parse_uuid(attachment_uuid)
    attachment = await attachments_service.get_owned_attachment(db, current_user.id, att_uuid) if att_uuid else None
    if attachment is None or not attachment.storage_key:
        raise HTTPException(status_code=404, detail="File not found")

    metadata = storage_service.resolve_url(attachment.storage_key)
    if metadata is None:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        stream = storage_service.get_file_stream(metadata)
    except storage_service.FileNotFoundInStorageError:
        raise HTTPException(status_code=404, detail="File not found")
    except storage_service.StorageError:
        raise HTTPException(status_code=503, detail="Storage temporarily unavailable")
    return StreamingResponse(
        stream,
        media_type=attachment.mime or "application/octet-stream",
        headers={"Cache-Control": "private, max-age=86400"},
    )
