"""Preview/commit/revert банковских выписок с пользовательской изоляцией."""
import asyncio
import hashlib
import json
import tempfile
import uuid
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from pathlib import PurePath

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config
from app.models.journal import (
    JournalFinanceCategory, JournalImportBatch, JournalImportProfile,
    JournalImportRule, JournalTransaction,
)
from app.models.journal.base import utcnow
from app.schemas.journal.finance import ImportBatchOut, ImportCommitRequest, ImportCommitResponse, ImportPreviewResponse
from app.services.journal.bank_import.dedup import transaction_fingerprint
from app.services.journal.bank_import.header import find_header, fingerprint, suggested_mapping
from app.services.journal.bank_import.mapping import normalize_rows, validate_mapping
from app.services.journal.bank_import.rules import match_rule
from app.services.journal.bank_import.sniff import file_format, parse_delimited, sniff_delimiter
from app.services.journal.sync_service import lock_state, next_rev

PREVIEW_TTL_SECONDS = 30 * 60
_PREVIEW_PREFIX = "journal:import-preview:"


class ImportNotFound(Exception):
    pass


def _preview_file(token: str) -> Path:
    return Path(tempfile.gettempdir()) / f"journal-import-preview-{token}.json"


async def _redis_client():
    import redis.asyncio as redis
    return redis.Redis(host=config.REDIS_HOST, port=int(config.REDIS_PORT), password=config.REDIS_PASSWORD or None, db=1,
                       socket_connect_timeout=0.5, socket_timeout=0.5)


async def _store_preview(user_id: int, token: str, payload: dict) -> None:
    raw = json.dumps(payload, ensure_ascii=False, default=str)
    try:
        client = await _redis_client()
        try:
            await client.set(f"{_PREVIEW_PREFIX}{user_id}:{token}", raw, ex=PREVIEW_TTL_SECONDS)
            return
        finally:
            await client.aclose()
    except Exception as exc:
        logger.warning(f"Journal import preview cache unavailable ({type(exc).__name__}); using short-lived local storage")
    path = _preview_file(token)
    path.write_text(json.dumps({"user_id": user_id, "expires_at": datetime.now().timestamp() + PREVIEW_TTL_SECONDS,
                                "payload": payload}, ensure_ascii=False, default=str), encoding="utf-8")


async def _load_preview(user_id: int, token: str) -> dict:
    try:
        token = str(uuid.UUID(token))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ImportNotFound from exc
    try:
        client = await _redis_client()
        try:
            raw = await client.get(f"{_PREVIEW_PREFIX}{user_id}:{token}")
            if raw:
                return json.loads(raw)
        finally:
            await client.aclose()
    except Exception:
        pass
    path = _preview_file(token)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise ImportNotFound
    if data.get("expires_at", 0) < datetime.now().timestamp():
        path.unlink(missing_ok=True)
        raise ImportNotFound
    if data.get("user_id") != user_id:
        raise ImportNotFound
    return data["payload"]


async def _delete_preview(user_id: int, token: str) -> None:
    try:
        token = str(uuid.UUID(token))
    except Exception:
        return
    try:
        client = await _redis_client()
        try:
            await client.delete(f"{_PREVIEW_PREFIX}{user_id}:{token}")
        finally:
            await client.aclose()
    except Exception:
        pass
    _preview_file(token).unlink(missing_ok=True)


def _cell_text(value: object) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat() if value.time().isoformat() == "00:00:00" else value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return "" if value is None else str(value)


def _parse_content(filename: str, content: bytes) -> tuple[str, str | None, list[str], list[list[str]]]:
    kind = file_format(filename, content)
    if kind == "xlsx":
        try:
            from openpyxl import load_workbook
        except ImportError as exc:
            raise ValueError("Для импорта XLSX отсутствует поддержка openpyxl") from exc
        workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
        try:
            sheet = workbook.active
            rows = []
            for index, row in enumerate(sheet.iter_rows(values_only=True)):
                if index > config.JOURNAL_IMPORT_MAX_ROWS + 15:
                    raise ValueError(f"В файле больше {config.JOURNAL_IMPORT_MAX_ROWS} строк")
                rows.append([_cell_text(value) for value in row])
        finally:
            workbook.close()
        delimiter = None
    else:
        from app.services.journal.bank_import.decoding import decode_text
        text = decode_text(content)
        delimiter = "\t" if kind == "tsv" else sniff_delimiter(text)
        rows = [[_cell_text(value) for value in row] for row in parse_delimited(text, delimiter)]
        if len(rows) > config.JOURNAL_IMPORT_MAX_ROWS + 15:
            raise ValueError(f"В файле больше {config.JOURNAL_IMPORT_MAX_ROWS} строк")
    header_index, headers = find_header(rows)
    data_rows = rows[header_index + 1:]
    if len(data_rows) > config.JOURNAL_IMPORT_MAX_ROWS:
        raise ValueError(f"В файле больше {config.JOURNAL_IMPORT_MAX_ROWS} строк")
    return kind, delimiter, headers, data_rows


async def preview(user_id: int, filename: str, content: bytes) -> ImportPreviewResponse:
    if len(content) > config.JOURNAL_IMPORT_MAX_BYTES:
        raise ValueError("Файл превышает лимит 10 МБ")
    safe_name = PurePath((filename or "statement.csv").replace("\\", "/")).name[:255]
    parsed = await asyncio.wait_for(asyncio.to_thread(_parse_content, safe_name, content),
                                    timeout=config.JOURNAL_IMPORT_PARSE_TIMEOUT)
    kind, delimiter, headers, rows = parsed
    header_hash = fingerprint(headers)
    mapping = suggested_mapping(headers)
    token = str(uuid.uuid4())
    payload = {
        "filename": safe_name, "file_format": kind, "delimiter": delimiter,
        "headers": headers, "header_fingerprint": header_hash, "rows": rows,
        "content_fingerprint": hashlib.sha256(content).hexdigest(),
    }
    await _store_preview(user_id, token, payload)
    display_rows = [{header: row[index] if index < len(row) else "" for index, header in enumerate(headers)}
                    for row in rows[:20]]
    return ImportPreviewResponse(
        preview_token=token, filename=safe_name, file_format=kind, headers=headers,
        header_fingerprint=header_hash, suggested_mapping=mapping, rows=display_rows,
        row_count=len(rows), warnings=[],
    )


async def commit(db: AsyncSession, user_id: int, request: ImportCommitRequest) -> ImportCommitResponse:
    payload = await _load_preview(user_id, request.preview_token)
    mapping = validate_mapping(request.mapping, payload["headers"])
    normalized = normalize_rows(payload["rows"], mapping, request.date_format)

    duplicates: set[str] = set()
    existing = (await db.execute(select(JournalTransaction).where(
        JournalTransaction.user_id == user_id, JournalTransaction.deleted_at.is_(None),
    ))).scalars().all()
    for transaction in existing:
        key = transaction_fingerprint({
            "transaction_date": transaction.transaction_date, "direction": transaction.direction,
            "amount_kop": transaction.amount_kop, "description": transaction.description,
            "merchant": transaction.merchant,
        })
        duplicates.add(key)

    rules = (await db.execute(select(JournalImportRule).where(
        JournalImportRule.user_id == user_id, JournalImportRule.deleted_at.is_(None),
        JournalImportRule.enabled.is_(True),
    ).order_by(JournalImportRule.priority, JournalImportRule.created_at))).scalars().all()
    categories = {category.id: category for category in (await db.execute(select(JournalFinanceCategory).where(
        JournalFinanceCategory.user_id == user_id, JournalFinanceCategory.deleted_at.is_(None),
    ))).scalars().all()}
    valid_rows = []
    duplicate_count = 0
    for item in normalized:
        key = transaction_fingerprint(item)
        if key in duplicates:
            duplicate_count += 1
            continue
        duplicates.add(key)
        item["category_id"] = match_rule(item, rules)
        if (item["category_id"] not in categories
                or categories[item["category_id"]].kind != item["direction"]):
            item["category_id"] = None
        item["review_required"] = item["category_id"] is None or item["ambiguous_date"]
        valid_rows.append(item)

    now = utcnow()
    state = await lock_state(db, user_id)
    profile = (await db.execute(select(JournalImportProfile).where(
        JournalImportProfile.user_id == user_id,
        JournalImportProfile.header_fingerprint == payload["header_fingerprint"],
        JournalImportProfile.deleted_at.is_(None),
    ))).scalar_one_or_none()
    profile_mapping = {key: value for key, value in mapping.items()}
    if profile is None:
        profile = JournalImportProfile(
            user_id=user_id, client_uuid=str(uuid.uuid4()), name=request.profile_name or payload["filename"],
            file_format=payload["file_format"], header_fingerprint=payload["header_fingerprint"],
            mapping=profile_mapping, date_format=request.date_format, delimiter=payload["delimiter"],
            created_at=now, updated_at=now, server_rev=next_rev(state),
        )
        db.add(profile)
    else:
        profile.mapping = profile_mapping
        profile.date_format = request.date_format
        profile.delimiter = payload["delimiter"]
        profile.updated_at = now
        profile.server_rev = next_rev(state)

    batch = JournalImportBatch(
        user_id=user_id, client_uuid=str(uuid.uuid4()), profile_id=None,
        filename=payload["filename"], content_fingerprint=payload["content_fingerprint"],
        status="committed", imported_count=len(valid_rows), duplicate_count=duplicate_count,
        created_at=now, updated_at=now, server_rev=next_rev(state),
    )
    db.add(batch)
    await db.flush()
    batch.profile_id = profile.id

    imported = []
    for item in valid_rows:
        transaction = JournalTransaction(
            user_id=user_id, client_uuid=str(uuid.uuid4()),
            transaction_date=item["transaction_date"], direction=item["direction"],
            amount_kop=item["amount_kop"], description=item["description"], merchant=item["merchant"],
            external_id=item["external_id"], category_id=item["category_id"], import_batch_id=batch.id,
            review_required=item["review_required"], source="import", created_at=now, updated_at=now,
            server_rev=next_rev(state),
        )
        db.add(transaction)
        item["client_uuid"] = transaction.client_uuid
        imported.append(item)
    await db.commit()
    await _delete_preview(user_id, request.preview_token)
    logger.info(f"Journal import committed: user={user_id} imported={len(imported)} duplicates={duplicate_count}")

    if imported:
        try:
            from app.core.celery_app import celery_app
            celery_app.send_task("journal.check_budgets", args=[
                user_id, sorted({item["transaction_date"].strftime("%Y-%m") for item in imported})
            ], retry=False)
        except Exception:
            logger.exception("Не удалось поставить проверку бюджетов после импорта")

    return ImportCommitResponse(
        batch_uuid=batch.client_uuid, imported_count=len(imported), duplicate_count=duplicate_count,
        review_count=sum(item["review_required"] for item in imported),
    )


async def revert(db: AsyncSession, user_id: int, batch_uuid: str) -> bool:
    batch = (await db.execute(select(JournalImportBatch).where(
        JournalImportBatch.user_id == user_id, JournalImportBatch.client_uuid == batch_uuid,
        JournalImportBatch.deleted_at.is_(None),
    ))).scalar_one_or_none()
    if batch is None:
        raise ImportNotFound
    if batch.status == "reverted":
        return False
    state = await lock_state(db, user_id)
    now = utcnow()
    transactions = (await db.execute(select(JournalTransaction).where(
        JournalTransaction.user_id == user_id, JournalTransaction.import_batch_id == batch.id,
        JournalTransaction.deleted_at.is_(None),
    ))).scalars().all()
    for transaction in transactions:
        transaction.deleted_at = now
        transaction.updated_at = now
        transaction.server_rev = next_rev(state)
    batch.status = "reverted"
    batch.reverted_at = now
    batch.updated_at = now
    batch.server_rev = next_rev(state)
    await db.commit()
    return True


async def list_batches(db: AsyncSession, user_id: int, limit: int = 100) -> list[ImportBatchOut]:
    batches = (await db.execute(select(JournalImportBatch).where(
        JournalImportBatch.user_id == user_id, JournalImportBatch.deleted_at.is_(None),
    ).order_by(JournalImportBatch.created_at.desc()).limit(limit))).scalars().all()
    return [ImportBatchOut(
        uuid=batch.client_uuid, filename=batch.filename, status=batch.status,
        imported_count=batch.imported_count, duplicate_count=batch.duplicate_count,
        created_at=batch.created_at, reverted_at=batch.reverted_at,
    ) for batch in batches]


async def batch_details(db: AsyncSession, user_id: int, batch_uuid: str) -> dict:
    batch = await db.scalar(select(JournalImportBatch).where(
        JournalImportBatch.user_id == user_id, JournalImportBatch.client_uuid == batch_uuid,
        JournalImportBatch.deleted_at.is_(None),
    ))
    if batch is None:
        raise ImportNotFound
    transactions = (await db.execute(select(JournalTransaction).where(
        JournalTransaction.user_id == user_id, JournalTransaction.import_batch_id == batch.id,
    ).order_by(JournalTransaction.transaction_date, JournalTransaction.id))).scalars().all()
    return {
        "uuid": batch.client_uuid, "filename": batch.filename, "status": batch.status,
        "imported_count": batch.imported_count, "duplicate_count": batch.duplicate_count,
        "created_at": batch.created_at, "reverted_at": batch.reverted_at,
        "transactions": [{
            "uuid": row.client_uuid, "transaction_date": row.transaction_date,
            "direction": row.direction, "amount_kop": row.amount_kop,
            "description": row.description, "merchant": row.merchant,
            "deleted_at": row.deleted_at,
        } for row in transactions],
    }