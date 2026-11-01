"""ИИ «Журнала жизни» (Ollama через backend): оценка КБЖУ по тексту."""
from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger

from app.core import config, ollama
from app.core.rate_limit import rate_limit
from app.models.users import User as UserModel
from app.schemas.journal.diet import EstimateNutritionRequest, EstimateNutritionResponse
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
