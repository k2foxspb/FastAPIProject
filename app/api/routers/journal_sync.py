"""
Синхронизация «Журнала жизни»: все создания/правки/удаления сущностей журнала
идут через push, изменения других устройств - через pull.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_async_db
from app.core import config
from app.core.auth import get_current_user
from app.models.users import User as UserModel
from app.schemas.journal.sync import SyncMetaResponse, SyncPullResponse, SyncPushRequest, SyncPushResponse
from app.services.journal import sync_service
from app.services.journal.seed import NS_JOURNAL, TRACKER_TEMPLATES
from app.services.journal.sync_registry import ordered_specs

router = APIRouter(prefix="/api/journal", tags=["journal"])


@router.post("/sync/push", response_model=SyncPushResponse)
async def sync_push(
    request: Request,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Принимает пачку изменений (идемпотентно по client_uuid, LWW по updated_at)."""
    body = await request.body()
    if len(body) > config.JOURNAL_SYNC_MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail="Слишком большая пачка изменений")
    try:
        payload = SyncPushRequest.model_validate_json(body)
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=e.errors(include_input=False, include_url=False, include_context=False))
    try:
        return await sync_service.push(db, current_user.id, payload)
    except sync_service.SyncError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


@router.get("/sync/pull", response_model=SyncPullResponse)
async def sync_pull(
    since: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=config.JOURNAL_SYNC_PULL_MAX_LIMIT),
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Изменения после курсора `since` (включая удалённые записи). 410 - нужна полная пересинхронизация."""
    try:
        return await sync_service.pull(db, current_user.id, since, limit)
    except sync_service.SyncError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


@router.get("/sync/meta", response_model=SyncMetaResponse)
async def sync_meta(current_user: UserModel = Depends(get_current_user)):
    """Параметры синхронизации для клиента: список сущностей, лимиты, пространство UUIDv5 стартовых наборов."""
    return SyncMetaResponse(
        user_id=current_user.id,
        seed_namespace=str(NS_JOURNAL),
        entities=[s.name for s in ordered_specs()],
        max_changes=config.JOURNAL_SYNC_MAX_CHANGES,
        max_bytes=config.JOURNAL_SYNC_MAX_BYTES,
        pull_max_limit=config.JOURNAL_SYNC_PULL_MAX_LIMIT,
        tracker_templates=TRACKER_TEMPLATES,
    )
