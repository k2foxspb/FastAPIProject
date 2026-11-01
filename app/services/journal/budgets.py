"""Пороговые уведомления финансовых бюджетов."""
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.journal import JournalBudget, JournalFinanceCategory, JournalTransaction
from app.models.notifications import Notification
from app.services.journal.finance import budget_status


async def check_budgets(db: AsyncSession, user_id: int, months: list[str]) -> list[dict]:
    """Создаёт по одному уведомлению на каждый достигнутый порог бюджета."""
    created: list[dict] = []
    for month in sorted(set(months)):
        for status in await budget_status(db, user_id, month):
            percent = status["percent"]
            budget_uuid = status["uuid"]
            thresholds = [80, 100] if percent >= 100 else ([80] if percent >= 80 else [])
            for threshold in thresholds:
                group_key = f"journal_budget:{budget_uuid}:{month}:{threshold}"
                existing = await db.scalar(select(Notification.id).where(
                    Notification.user_id == user_id, Notification.group_key == group_key,
                ).limit(1))
                if existing:
                    continue
                title = "Лимит бюджета достигнут" if threshold == 100 else "Бюджет почти исчерпан"
                body = f"{status['category_name']}: использовано {percent:g}% лимита за {month}."
                notification = Notification(
                    user_id=user_id,
                    notif_type="journal_budget",
                    title=title,
                    body=body,
                    group_key=group_key,
                    data={"type": "journal_budget", "budget_uuid": budget_uuid, "month": month},
                )
                db.add(notification)
                created.append({"title": title, "body": body, "data": notification.data})
    if created:
        await db.commit()
    return created