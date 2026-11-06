"""Периодические задачи журнала: tombstones, превью импорта и сводки."""
import asyncio
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from celery.schedules import crontab
from loguru import logger
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core import config
from app.core.celery_app import celery_app
from app.core.notification_service import create_or_group_notification
from app.models.journal import JournalSettings, JournalSyncState
from app.services.journal.sync_registry import ordered_specs

_engine = create_async_engine(config.DATABASE_URL, poolclass=NullPool)
_sessions = async_sessionmaker(_engine, expire_on_commit=False)


@celery_app.task(name="journal.weekly_summary")
def weekly_summary_scan() -> int:
    """Понедельник 09:00 по локальному времени пользователя: сводка за прошедшую неделю."""
    async def run() -> int:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
        from app.services.journal import ai

        sent = 0
        now_utc = datetime.now(timezone.utc)
        async with _sessions() as db:
            rows = (await db.execute(select(JournalSettings.user_id, JournalSettings.timezone))).all()
        for user_id, tz_name in rows:
            try:
                local_now = now_utc.astimezone(ZoneInfo(tz_name))
            except (ZoneInfoNotFoundError, ValueError):
                continue
            if local_now.weekday() != 0 or local_now.hour != 9:
                continue
            last_monday = local_now.date() - timedelta(days=7)
            last_sunday = last_monday + timedelta(days=6)
            async with _sessions() as db:
                text = await ai.weekly_summary(db, user_id, last_monday, last_sunday)
                await create_or_group_notification(
                    db,
                    user_id=user_id,
                    notif_type="journal_summary",
                    title="Сводка за неделю",
                    body=text[:200],
                    data={"type": "journal_summary", "week_start": last_monday.isoformat()},
                    group_key=f"journal_summary:{last_monday.isoformat()}",
                )
            sent += 1
        return sent
    return asyncio.run(run())


@celery_app.task(name="journal.purge_tombstones")
def purge_tombstones() -> int:
    async def run() -> int:
        cutoff = datetime.now(timezone.utc) - timedelta(days=config.JOURNAL_TOMBSTONE_TTL_DAYS)
        removed = 0
        async with _sessions() as db:
            for spec in reversed(ordered_specs()):
                model = spec.model
                expired = (await db.execute(select(model.user_id, func.max(model.server_rev)).where(
                    model.deleted_at.is_not(None), model.deleted_at < cutoff,
                ).group_by(model.user_id))).all()
                for user_id, max_rev in expired:
                    await db.execute(update(JournalSyncState).where(
                        JournalSyncState.user_id == user_id,
                        JournalSyncState.purged_rev < max_rev,
                    ).values(purged_rev=max_rev))
                    result = await db.execute(delete(model).where(
                        model.user_id == user_id, model.deleted_at.is_not(None), model.deleted_at < cutoff,
                    ))
                    removed += result.rowcount or 0
            await db.commit()
        return removed
    return asyncio.run(run())


@celery_app.task(name="journal.cleanup_import_previews")
def cleanup_import_previews() -> int:
    async def cleanup_redis() -> int:
        import redis.asyncio as redis
        client = redis.Redis(host=config.REDIS_HOST, port=int(config.REDIS_PORT), password=config.REDIS_PASSWORD or None, db=1,
                             socket_connect_timeout=0.5, socket_timeout=0.5)
        removed_count = 0
        try:
            async for key in client.scan_iter(match="journal:import-preview:*", count=500):
                ttl = await client.ttl(key)
                if ttl < 0:
                    removed_count += await client.delete(key)
        finally:
            await client.aclose()
        return removed_count

    removed = 0
    try:
        removed += asyncio.run(cleanup_redis())
    except Exception as exc:
        logger.debug(f"Redis preview cleanup skipped ({type(exc).__name__})")
    now = datetime.now().timestamp()
    for path in Path(tempfile.gettempdir()).glob("journal-import-preview-*.json"):
        try:
            if now - path.stat().st_mtime > 30 * 60:
                path.unlink(missing_ok=True)
                removed += 1
        except OSError:
            continue
    return removed


celery_app.conf.beat_schedule = {
    **(celery_app.conf.beat_schedule or {}),
    "journal-purge-tombstones": {"task": "journal.purge_tombstones", "schedule": crontab(hour=2, minute=30)},
    "journal-cleanup-import-previews": {"task": "journal.cleanup_import_previews", "schedule": 900.0},
    "journal-weekly-summary": {"task": "journal.weekly_summary", "schedule": crontab(hour="*", minute=5, day_of_week=1)},
}