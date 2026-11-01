"""ИИ «Журнала жизни» (Ollama через backend): оценка КБЖУ по тексту."""
from datetime import date
from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_async_db

from app.core import config, ollama
from app.core.rate_limit import rate_limit
from app.models.users import User as UserModel
from app.schemas.journal.diet import EstimateNutritionRequest, EstimateNutritionResponse
from app.schemas.journal.finance import CategorySuggestionRequest, CategorySuggestionResponse
from app.schemas.journal.goals import WeeklySummaryResponse
from app.services.journal import ai as ai_service

router = APIRouter(prefix="/api/journal/ai", tags=["journal"])

# Общий лимит ИИ-запросов журнала на пользователя (429 при превышении)
_ai_limit = rate_limit("journal_ai", config.JOURNAL_AI_RATE_LIMIT_PER_HOUR, 3600)


def raise_ai_error(e: ollama.OllamaError) -> NoReturn:
    """Ошибка Ollama -> понятный HTTP-ответ: таймаут 504, остальное 502."""
    if isinstance(e, ollama.OllamaTimeout):
        raise HTTPException(status_code=504, detail=e.message)
    if isinstance(e, ollama.OllamaBadResponse):
        raise HTTPException(status_code=502, detail=e.message)
    raise HTTPException(status_code=502, detail="Сервис ИИ временно недоступен. Попробуйте позже.")


@router.post("/estimate-nutrition", response_model=EstimateNutritionResponse)
async def estimate_nutrition(
    payload: EstimateNutritionRequest,
    current_user: UserModel = Depends(_ai_limit),
):
    """
    Оценка КБЖУ по описанию («съел борщ и 2 куска хлеба»). Ничего не сохраняет:
    приложение показывает результат для подтверждения или правки.
    """
    try:
        result = await ai_service.estimate_nutrition(payload.text)
    except ollama.OllamaError as e:
        raise_ai_error(e)
    # Текст запроса и значения в лог не пишем (личные данные)
    logger.info(f"Journal AI estimate: user={current_user.id} items={len(result.items)}")
    return result


@router.get("/weekly-summary", response_model=WeeklySummaryResponse)
async def weekly_summary(
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    current_user: UserModel = Depends(_ai_limit),
    db: AsyncSession = Depends(get_async_db),
):
    """Короткая ИИ-сводка за период по питанию и воде. Ничего не сохраняет."""
    if date_to < date_from:
        raise HTTPException(status_code=422, detail="Конец периода раньше начала")
    if (date_to - date_from).days + 1 > 14:
        raise HTTPException(status_code=422, detail="Период сводки не длиннее 14 дней")
    try:
        text = await ai_service.weekly_summary(db, current_user.id, date_from, date_to)
    except ollama.OllamaError as e:
        raise_ai_error(e)
    return WeeklySummaryResponse(date_from=date_from, date_to=date_to, summary=text)


@router.post("/suggest-categories", response_model=CategorySuggestionResponse)
async def suggest_categories(
    payload: CategorySuggestionRequest,
    current_user: UserModel = Depends(_ai_limit),
    db: AsyncSession = Depends(get_async_db),
):
    """ИИ предлагает категории расходов, но ничего не сохраняет автоматически."""
    try:
        return await ai_service.suggest_categories(db, current_user.id, payload.descriptions)
    except ollama.OllamaError as e:
        raise_ai_error(e)
