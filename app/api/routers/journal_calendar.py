"""Календарь «Журнала жизни»: краткие итоги по дням месяца и сводка дня."""
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_async_db
from app.core.auth import get_current_user
from app.models.users import User as UserModel
from app.schemas.journal.calendar import CalendarMonthResponse, DayResponse
from app.schemas.journal.common import MAX_DATE, MIN_DATE
from app.services.journal import calendar as calendar_service

router = APIRouter(prefix="/api/journal", tags=["journal"])

_MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")


@router.get("/calendar", response_model=CalendarMonthResponse)
async def get_calendar_month(
    month: str = Query(..., description="Месяц в формате YYYY-MM"),
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Итоги по каждому дню месяца одним запросом (ккал, расход, дневник, события)."""
    match = _MONTH_RE.match(month)
    if not match or not 1 <= int(match.group(2)) <= 12:
        raise HTTPException(status_code=422, detail="Месяц должен быть в формате YYYY-MM")
    year, mon = int(match.group(1)), int(match.group(2))
    if not MIN_DATE.year <= year <= MAX_DATE.year:
        raise HTTPException(status_code=422, detail="Год вне допустимого диапазона")
    return await calendar_service.month_summary(db, current_user.id, year, mon)


@router.get("/day", response_model=DayResponse)
async def get_day(
    day: date = Query(..., alias="date"),
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Всё за день: экземпляры событий, записи дневника, значения трекеров и итоги."""
    if not MIN_DATE <= day <= MAX_DATE:
        raise HTTPException(status_code=422, detail="Дата вне допустимого диапазона")
    return await calendar_service.day_details(db, current_user.id, day)
