"""Preview, commit, история и откат импорта выписок."""
import asyncio

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_async_db
from app.core import config
from app.core.auth import get_current_user
from app.core.rate_limit import rate_limit
from app.models.users import User as UserModel
from app.schemas.journal.finance import ImportCommitRequest, ImportCommitResponse, ImportPreviewResponse
from app.services.journal.bank_import import service

router = APIRouter(prefix="/api/journal/import", tags=["journal"])
_import_limit = rate_limit("journal_import", config.JOURNAL_IMPORT_RATE_LIMIT_PER_HOUR, 3600)


@router.post("/preview", response_model=ImportPreviewResponse)
async def import_preview(
    file: UploadFile = File(...),
    current_user: UserModel = Depends(_import_limit),
):
    content = await file.read(config.JOURNAL_IMPORT_MAX_BYTES + 1)
    if len(content) > config.JOURNAL_IMPORT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Файл превышает лимит 10 МБ")
    try:
        return await service.preview(current_user.id, file.filename or "statement.csv", content)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=408, detail="Превышено время разбора выписки")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/commit", response_model=ImportCommitResponse)
async def import_commit(
    payload: ImportCommitRequest,
    current_user: UserModel = Depends(get_current_user), db: AsyncSession = Depends(get_async_db),
):
    try:
        return await service.commit(db, current_user.id, payload)
    except service.ImportNotFound:
        raise HTTPException(status_code=404, detail="Превью или счёт не найдены")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/batches")
async def import_batches(
    limit: int = Query(default=100, ge=1, le=500),
    current_user: UserModel = Depends(get_current_user), db: AsyncSession = Depends(get_async_db),
):
    return {"items": await service.list_batches(db, current_user.id, limit)}


@router.get("/batches/{batch_uuid}")
async def import_batch_details(
    batch_uuid: str,
    current_user: UserModel = Depends(get_current_user), db: AsyncSession = Depends(get_async_db),
):
    try:
        return await service.batch_details(db, current_user.id, batch_uuid)
    except service.ImportNotFound:
        raise HTTPException(status_code=404, detail="Партия импорта не найдена")


@router.post("/batches/{batch_uuid}/revert")
async def import_revert(
    batch_uuid: str,
    current_user: UserModel = Depends(get_current_user), db: AsyncSession = Depends(get_async_db),
):
    try:
        reverted = await service.revert(db, current_user.id, batch_uuid)
    except service.ImportNotFound:
        raise HTTPException(status_code=404, detail="Партия импорта не найдена")
    return {"status": "reverted" if reverted else "already_reverted"}