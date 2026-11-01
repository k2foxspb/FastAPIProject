"""Аналитика и цели «Журнала жизни»: прогресс целей."""
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_async_db
from app.core.auth import get_current_user
from app.models.journal import JournalGoal
from app.models.users import User as UserModel
from app.schemas.journal.goals import GoalProgress
from app.services.journal import goals as goals_service

router = APIRouter(prefix="/api/journal", tags=["journal"])


@router.get("/goals/progress", response_model=list[GoalProgress])
async def goals_progress(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Прогресс всех активных целей пользователя по данным журнала."""
    today = datetime.now(timezone.utc).date()
    goals = (await db.execute(select(JournalGoal).where(
        JournalGoal.user_id == current_user.id,
        JournalGoal.deleted_at.is_(None),
        JournalGoal.status == "active",
    ).order_by(JournalGoal.start_date))).scalars().all()
    return [await goals_service.goal_progress(db, current_user.id, goal, today) for goal in goals]
