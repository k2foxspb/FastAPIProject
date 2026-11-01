"""
Синхронизация журнала (push/pull).

- Курсор - монотонный server_rev пользователя (journal_sync_state.last_rev),
  выдаётся в той же транзакции под блокировкой строки состояния, поэтому pull
  не теряет изменений при одинаковых метках времени и расхождении часов.
- Конфликты - last-write-wins по клиентскому updated_at (значение из будущего
  обрезается до текущего времени сервера). Повтор того же изменения идемпотентен.
- Все ссылки *_uuid разрешаются только среди записей текущего пользователя.
- Удаление мягкое (deleted_at) и каскадно помечает дочерние записи.
"""
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Any

from loguru import logger
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config
from app.models.journal import JournalSyncState
from app.models.journal.base import utcnow
from app.schemas.journal.sync import (
    SyncChange, SyncPullChange, SyncPullResponse, SyncPushRequest, SyncPushResponse, SyncResult,
)
from app.services.journal import seed
from app.services.journal.sync_registry import (
    REGISTRY, EntitySpec, children_of, get_spec, ordered_specs, poly_children_of,
)

# Не отдаются клиенту: внутренние ключи и служебные поля (storage_key - путь к файлу в хранилище).
INTERNAL_COLUMNS = {"id", "user_id", "client_uuid", "server_rev", "deleted_at", "storage_key", "import_batch_id"}


@dataclass
class SyncError(Exception):
    status_code: int
    detail: str


# ---------------------------------------------------------------- служебное

def as_utc(value: datetime | None) -> datetime | None:
    """SQLite возвращает datetime без таймзоны - считаем такие значения UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return as_utc(value).isoformat()
    if isinstance(value, (date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        # КБЖУ и значения трекеров - не деньги, float здесь допустим (деньги - целые копейки).
        return int(value) if value == value.to_integral_value() else float(value)
    return value


async def lock_state(db: AsyncSession, user_id: int) -> JournalSyncState:
    """Возвращает строку состояния sync пользователя под блокировкой (создаёт при отсутствии)."""
    stmt = select(JournalSyncState).where(JournalSyncState.user_id == user_id).with_for_update()
    state = (await db.execute(stmt)).scalar_one_or_none()
    if state is not None:
        return state
    try:
        async with db.begin_nested():
            state = JournalSyncState(user_id=user_id, last_rev=0, purged_rev=0)
            db.add(state)
    except IntegrityError:
        # Параллельный запрос успел создать строку
        state = (await db.execute(stmt)).scalar_one()
    return state


def next_rev(state: JournalSyncState) -> int:
    state.last_rev = (state.last_rev or 0) + 1
    return state.last_rev


async def find_alive(db: AsyncSession, model, user_id: int, client_uuid: str):
    return (await db.execute(
        select(model).where(
            model.user_id == user_id,
            model.client_uuid == client_uuid,
            model.deleted_at.is_(None),
        )
    )).scalar_one_or_none()


async def serialize_rows(db: AsyncSession, spec: EntitySpec, rows: list) -> list[dict]:
    """Данные записей для клиента: без внутренних id, ссылки - через *_uuid."""
    ref_maps: dict[str, dict[int, str]] = {}
    for ref in spec.refs:
        ids = {getattr(r, ref.column) for r in rows if getattr(r, ref.column) is not None}
        target = get_spec(ref.target).model
        mapping: dict[int, str] = {}
        if ids:
            res = await db.execute(select(target.id, target.client_uuid).where(target.id.in_(ids)))
            mapping = {row_id: uuid for row_id, uuid in res.all()}
        ref_maps[ref.column] = mapping

    ref_by_column = {ref.column: ref for ref in spec.refs}
    result = []
    for row in rows:
        data: dict[str, Any] = {}
        for column in spec.model.__table__.columns:
            name = column.key
            if name in INTERNAL_COLUMNS:
                continue
            value = getattr(row, name)
            if name in ref_by_column:
                data[ref_by_column[name].field] = ref_maps[name].get(value) if value is not None else None
                continue
            data[name] = json_value(value)
        result.append(data)
    return result


async def current_state(db: AsyncSession, spec: EntitySpec, row) -> dict:
    data = (await serialize_rows(db, spec, [row]))[0] if row.deleted_at is None else None
    return {
        "server_rev": row.server_rev,
        "deleted_at": json_value(row.deleted_at),
        "data": data,
    }


def _short_errors(exc: ValidationError) -> str:
    parts = []
    for err in exc.errors()[:5]:
        loc = ".".join(str(x) for x in err.get("loc", ()) if x != "__root__") or "data"
        parts.append(f"{loc}: {err.get('msg')}")
    return "; ".join(parts)


# ---------------------------------------------------------------- push

async def _cascade_delete(db: AsyncSession, user_id: int, state: JournalSyncState,
                          spec: EntitySpec, row, now: datetime, deleted_files: list[str]) -> None:
    for child_spec, ref in children_of(spec.name):
        model = child_spec.model
        children = (await db.execute(
            select(model).where(
                model.user_id == user_id,
                getattr(model, ref.column) == row.id,
                model.deleted_at.is_(None),
            )
        )).scalars().all()
        for child in children:
            if ref.on_delete == "set_null":
                # Запись остаётся, ссылка обнуляется; новая ревизия доставит это клиентам
                setattr(child, ref.column, None)
                child.updated_at = now
                child.server_rev = next_rev(state)
                continue
            await _soft_delete(db, user_id, state, child_spec, child, now, now, deleted_files)

    for child_spec, poly, type_value in poly_children_of(spec.name):
        model = child_spec.model
        children = (await db.execute(
            select(model).where(
                model.user_id == user_id,
                getattr(model, poly.type_field) == type_value,
                getattr(model, poly.uuid_field) == row.client_uuid,
                model.deleted_at.is_(None),
            )
        )).scalars().all()
        for child in children:
            await _soft_delete(db, user_id, state, child_spec, child, now, now, deleted_files)


async def _soft_delete(db: AsyncSession, user_id: int, state: JournalSyncState, spec: EntitySpec,
                       row, ts: datetime, now: datetime, deleted_files: list[str]) -> None:
    if row.deleted_at is None:
        row.deleted_at = now
    row.updated_at = ts
    row.server_rev = next_rev(state)
    if spec.name == "attachment" and getattr(row, "storage_key", None):
        deleted_files.append(row.storage_key)
    await _cascade_delete(db, user_id, state, spec, row, now, deleted_files)


async def _apply_change(db: AsyncSession, user_id: int, state: JournalSyncState, change: SyncChange,
                        now: datetime, deleted_files: list[str]) -> SyncResult:
    def result(status: str, reason: str | None = None, server_rev: int | None = None,
               current: dict | None = None) -> SyncResult:
        return SyncResult(entity=change.entity, client_uuid=change.client_uuid, status=status,
                          reason=reason, server_rev=server_rev, current=current)

    spec = get_spec(change.entity)
    if spec is None:
        return result("rejected", "unknown_entity")
    if change.op not in spec.ops:
        return result("rejected", "op_not_allowed")

    model = spec.model
    ts = min(as_utc(change.updated_at), now)
    existing = (await db.execute(
        select(model).where(model.user_id == user_id, model.client_uuid == change.client_uuid)
    )).scalar_one_or_none()

    if existing is not None:
        existing_ts = as_utc(existing.updated_at)
        is_deleted = existing.deleted_at is not None
        if existing_ts > ts:
            return result("stale", server_rev=existing.server_rev, current=await current_state(db, spec, existing))
        if existing_ts == ts:
            if (change.op == "delete") == is_deleted:
                # Повторная отправка того же изменения - ничего не меняем
                return result("applied", server_rev=existing.server_rev)
            if change.op == "upsert":
                # При равных метках удаление побеждает
                return result("stale", server_rev=existing.server_rev,
                              current=await current_state(db, spec, existing))

    if change.op == "delete":
        if existing is None:
            return result("applied")
        await _soft_delete(db, user_id, state, spec, existing, ts, now, deleted_files)
        return result("applied", server_rev=existing.server_rev)

    # upsert
    try:
        data = spec.schema.model_validate(change.data or {})
    except ValidationError as e:
        return result("rejected", f"invalid: {_short_errors(e)}")
    values = data.model_dump()

    resolved: dict[str, Any] = {}
    for ref in spec.refs:
        ref_uuid = values.pop(ref.field, None)
        if ref_uuid is None:
            values[ref.column] = None
            continue
        target = await find_alive(db, get_spec(ref.target).model, user_id, ref_uuid)
        if target is None:
            return result("rejected", f"missing_ref:{ref.field}")
        values[ref.column] = target.id
        resolved[ref.field] = target

    for poly in spec.poly_refs:
        type_value = values.get(poly.type_field)
        ref_uuid = values.get(poly.uuid_field)
        if type_value is None or ref_uuid is None:
            continue
        target_name = poly.targets.get(type_value)
        if target_name is None or target_name not in REGISTRY:
            return result("rejected", f"unsupported_ref_type:{type_value}")
        target = await find_alive(db, REGISTRY[target_name].model, user_id, ref_uuid)
        if target is None:
            return result("rejected", f"missing_ref:{poly.uuid_field}")
        resolved[poly.uuid_field] = target

    if spec.validate is not None:
        reason = await spec.validate(db, user_id, existing, values, resolved)
        if reason:
            current = await current_state(db, spec, existing) if existing is not None else None
            return result("rejected", reason, current=current)

    row = existing
    if row is None:
        row = model(user_id=user_id, client_uuid=change.client_uuid, created_at=now)
        db.add(row)
    for key, value in values.items():
        setattr(row, key, value)
    row.deleted_at = None
    row.updated_at = ts
    row.server_rev = next_rev(state)
    await db.flush()
    return result("applied", server_rev=row.server_rev)


async def push(db: AsyncSession, user_id: int, request: SyncPushRequest) -> SyncPushResponse:
    if len(request.changes) > config.JOURNAL_SYNC_MAX_CHANGES:
        raise SyncError(413, f"Не больше {config.JOURNAL_SYNC_MAX_CHANGES} изменений в одной пачке")

    state = await lock_state(db, user_id)
    now = utcnow()

    def sort_key(item: tuple[int, SyncChange]):
        index, change = item
        spec = REGISTRY.get(change.entity)
        order = spec.order if spec else 0
        # Создания/правки: родители раньше детей; удаления - после, дети раньше родителей
        return (0, order, index) if change.op == "upsert" else (1, -order, index)

    results: dict[int, SyncResult] = {}
    deleted_files: list[str] = []
    applied_by_hook: dict[Any, list[SyncChange]] = {}
    for index, change in sorted(enumerate(request.changes), key=sort_key):
        results[index] = await _apply_change(db, user_id, state, change, now, deleted_files)
        spec = REGISTRY.get(change.entity)
        if results[index].status == "applied" and spec is not None and spec.after_apply is not None:
            applied_by_hook.setdefault(spec.after_apply, []).append(change)

    cursor = state.last_rev
    await db.commit()

    for hook, changes in applied_by_hook.items():
        try:
            hook(user_id, changes)
        except Exception:
            logger.exception("Journal sync after_apply hook failed")

    if deleted_files:
        from app.utils import storage as storage_service
        for key in deleted_files:
            storage_service.delete("journal", key)

    applied = sum(1 for r in results.values() if r.status == "applied")
    logger.info(f"Journal sync push: user={user_id} changes={len(request.changes)} applied={applied}")
    return SyncPushResponse(results=[results[i] for i in range(len(request.changes))], cursor=cursor)


# ---------------------------------------------------------------- pull

async def pull(db: AsyncSession, user_id: int, since: int, limit: int) -> SyncPullResponse:
    limit = max(1, min(limit, config.JOURNAL_SYNC_PULL_MAX_LIMIT))

    # Полная синхронизация создаёт стартовые наборы; обычный pull только досоздаёт наборы новых
    # фаз у уже синхронизированных клиентов (если версия актуальна - это один SELECT).
    if await seed.ensure_seed(db, user_id, only_upgrade=since != 0):
        await db.commit()

    state = (await db.execute(
        select(JournalSyncState).where(JournalSyncState.user_id == user_id)
    )).scalar_one_or_none()
    last_rev = state.last_rev if state else 0
    purged_rev = state.purged_rev if state else 0
    if since > last_rev or (0 < since < purged_rev):
        raise SyncError(410, "Курсор синхронизации устарел, требуется полная синхронизация")

    collected: list[tuple[EntitySpec, Any]] = []
    for spec in ordered_specs():
        model = spec.model
        rows = (await db.execute(
            select(model)
            .where(model.user_id == user_id, model.server_rev > since)
            .order_by(model.server_rev)
            .limit(limit + 1)
        )).scalars().all()
        collected.extend((spec, row) for row in rows)

    collected.sort(key=lambda item: item[1].server_rev)
    has_more = len(collected) > limit
    page = collected[:limit]

    # Сериализуем пачками по сущностям, сохраняя порядок ревизий
    by_spec: dict[str, list] = {}
    for spec, row in page:
        if row.deleted_at is None:
            by_spec.setdefault(spec.name, []).append(row)
    serialized: dict[tuple[str, int], dict] = {}
    for name, rows in by_spec.items():
        for row, data in zip(rows, await serialize_rows(db, REGISTRY[name], rows)):
            serialized[(name, row.id)] = data

    changes = [
        SyncPullChange(
            entity=spec.name,
            client_uuid=row.client_uuid,
            server_rev=row.server_rev,
            deleted_at=as_utc(row.deleted_at),
            data=serialized.get((spec.name, row.id)),
        )
        for spec, row in page
    ]
    cursor = page[-1][1].server_rev if has_more else last_rev
    return SyncPullResponse(changes=changes, cursor=cursor, has_more=has_more)
