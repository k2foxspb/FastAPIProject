"""Периодические задачи журнала: бюджеты, tombstones и превью импорта."""
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
from app.core.fcm import send_fcm_notification
from app.models.journal import JournalBudget, JournalSyncState
from app.models.users import User
from app.services.journal import budgets
from app.services.journal.sync_registry import ordered_specs

_engine = create_async_engine(config.DATABASE_URL, poolclass=NullPool)
_sessions = async_sessionmaker(_engine, expire_on_commit=False)


async def _check_budgets(user_id: int, months: list[str]) -> int:
    async with _sessions() as db:
        notifications = await budgets.check_budgets(db, user_id, months)
        user = await db.get(User, user_id)
        token = user.fcm_token if user else None
    if token:
        for notification in notifications:
            try:
                await send_fcm_notification(
                    token=token, title=notification["title"], body=notification["body"],
                    data={**notification["data"], "type": "journal_budget", "notification_group": "journal"},
                    silent=False,
                )
            except Exception:
                logger.exception("Journal budget push failed")
    return len(notifications)


@celery_app.task(name="journal.check_budgets")
def check_budgets(user_id: int, months: list[str]) -> int:
    return asyncio.run(_check_budgets(user_id, months))


@celery_app.task(name="journal.daily_budget_scan")
def daily_budget_scan() -> int:
    async def run() -> int:
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        async with _sessions() as db:
            user_ids = (await db.execute(select(JournalBudget.user_id).where(
                JournalBudget.period_month == month, JournalBudget.deleted_at.is_(None), JournalBudget.enabled.is_(True)
            ).distinct())).scalars().all()
        count = 0
        for user_id in user_ids:
            count += await _check_budgets(user_id, [month])
        return count
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
        client = redis.Redis(host=config.REDIS_HOST, port=int(config.REDIS_PORT), db=1,
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
    "journal-daily-budget-scan": {"task": "journal.daily_budget_scan", "schedule": crontab(hour=20, minute=0)},
    "journal-purge-tombstones": {"task": "journal.purge_tombstones", "schedule": crontab(hour=2, minute=30)},
    "journal-cleanup-import-previews": {"task": "journal.cleanup_import_previews", "schedule": 900.0},
}