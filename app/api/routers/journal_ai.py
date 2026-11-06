"""ИИ «Журнала жизни» (Ollama через backend): оценка КБЖУ по тексту."""
import json
from datetime import date
from typing import AsyncIterator, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_async_db

from app.core import config, ollama
from app.core.rate_limit import rate_limit
from app.models.users import User as UserModel
from app.schemas.journal.analysis import AnalysisResponse
from app.schemas.journal.diet import EstimateNutritionRequest, EstimateNutritionResponse
from app.schemas.journal.finance import CategorySuggestionRequest, CategorySuggestionResponse
from app.schemas.journal.goals import WeeklySummaryResponse
from app.services.journal import ai as ai_service
from app.services.journal import ai_analysis
from app.services.journal import nutrition_plan
from app.services.journal.nutrition_plan import NutritionPlanResponse

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


@router.get("/analysis", response_model=AnalysisResponse)
async def analysis(
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    areas: str = Query("food,finance,body,trackers"),
    current_user: UserModel = Depends(_ai_limit),
    db: AsyncSession = Depends(get_async_db),
):
    """ИИ-аналитика по сферам журнала за период. Ничего не сохраняет."""
    if date_to < date_from:
        raise HTTPException(status_code=422, detail="Конец периода раньше начала")
    if (date_to - date_from).days + 1 > 366:
        raise HTTPException(status_code=422, detail="Период аналитики не длиннее года")
    selected = [area.strip() for area in areas.split(",") if area.strip()]
    if not selected or any(area not in ai_analysis.AREA_TITLES for area in selected):
        raise HTTPException(status_code=422, detail="Неизвестная сфера аналитики")
    try:
        return await ai_analysis.analyze(db, current_user.id, date_from, date_to, selected)
    except ollama.OllamaError as e:
        raise_ai_error(e)


NUTRITION_FALLBACK_TEXT = "ИИ не смог подготовить корректировку. Показана формульная норма - её можно поправить вручную и сохранить."


def _nutrition_profile(
    current_user: UserModel, payload: nutrition_plan.NutritionPlanRequest
) -> tuple[nutrition_plan.NutritionPlanInput, nutrition_plan.NutritionPlanResult]:
    if not (current_user.gender and current_user.birth_date and current_user.height_cm and current_user.weight_kg):
        raise HTTPException(status_code=422, detail="Заполните пол, дату рождения, рост и вес в профиле")
    profile = nutrition_plan.NutritionPlanInput(
        sex=current_user.gender,
        age=nutrition_plan.age_from_birth_date(current_user.birth_date, date.today()),
        height_cm=current_user.height_cm,
        weight_kg=float(current_user.weight_kg),
        activity=payload.activity,
        goal=payload.goal,
    )
    return profile, nutrition_plan.calculate_plan(profile)


async def _collect_nutrition_advice(profile: nutrition_plan.NutritionPlanInput, plan: nutrition_plan.NutritionPlanResult) -> str:
    parts = []
    try:
        async for piece in ai_service.nutrition_advice_stream(profile, plan):
            parts.append(piece)
    except ollama.OllamaError as e:
        logger.warning(f"Journal AI nutrition advice: {e.message}")
    return "".join(parts).strip()[:2000]


@router.post("/nutrition-plan", response_model=NutritionPlanResponse)
async def nutrition_plan_advice(
    payload: nutrition_plan.NutritionPlanRequest,
    current_user: UserModel = Depends(_ai_limit),
):
    """Норма КБЖУ по анкете профиля: формула и корректировка ИИ с советами. Ничего не сохраняет."""
    profile, plan = _nutrition_profile(current_user, payload)
    try:
        answer = await ai_service.nutrition_numbers(profile, plan)
    except ollama.OllamaBadResponse as e:
        # Формульная норма уже посчитана: при некорректном ответе ИИ отдаём её без корректировки
        logger.warning(f"Journal AI nutrition plan: user={current_user.id} fallback: {e.message}")
        return NutritionPlanResponse(plan=plan, recommended=plan, advice=NUTRITION_FALLBACK_TEXT)
    except ollama.OllamaError as e:
        raise_ai_error(e)
    recommended = nutrition_plan.apply_ai_correction(
        plan, payload.goal, answer.kcal, answer.protein_pct, answer.fat_pct, answer.carbs_pct
    )
    advice = await _collect_nutrition_advice(profile, plan)
    logger.info(f"Journal AI nutrition plan: user={current_user.id}")
    return NutritionPlanResponse(plan=plan, recommended=recommended, advice=advice)


def _ndjson(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False) + "\n"


async def _stream_nutrition_plan(
    profile: nutrition_plan.NutritionPlanInput,
    plan: nutrition_plan.NutritionPlanResult,
    goal: str,
    user_id: int,
) -> AsyncIterator[str]:
    """NDJSON: сначала {"plan", "recommended"} с числами, затем {"delta"} по мере генерации советов, в конце {"done", "advice"}."""
    try:
        answer = await ai_service.nutrition_numbers(profile, plan)
    except ollama.OllamaBadResponse as e:
        logger.warning(f"Journal AI nutrition plan: user={user_id} fallback: {e.message}")
        yield _ndjson({"plan": plan.model_dump(), "recommended": plan.model_dump(), "fallback": True})
        yield _ndjson({"done": True, "advice": NUTRITION_FALLBACK_TEXT})
        return
    except ollama.OllamaError as e:
        yield _ndjson({"error": e.message})
        return
    recommended = nutrition_plan.apply_ai_correction(
        plan, goal, answer.kcal, answer.protein_pct, answer.fat_pct, answer.carbs_pct
    )
    yield _ndjson({"plan": plan.model_dump(), "recommended": recommended.model_dump()})
    parts = []
    try:
        async for piece in ai_service.nutrition_advice_stream(profile, plan):
            parts.append(piece)
            yield _ndjson({"delta": piece})
    except ollama.OllamaError as e:
        logger.warning(f"Journal AI nutrition advice: {e.message}")
    logger.info(f"Journal AI nutrition plan: user={user_id} stream")
    yield _ndjson({"done": True, "advice": "".join(parts).strip()[:2000]})


@router.post("/nutrition-plan/stream")
async def nutrition_plan_advice_stream(
    payload: nutrition_plan.NutritionPlanRequest,
    current_user: UserModel = Depends(_ai_limit),
):
    """То же, что /nutrition-plan, но советы ИИ приходят потоком (NDJSON). Ничего не сохраняет."""
    profile, plan = _nutrition_profile(current_user, payload)
    return StreamingResponse(
        _stream_nutrition_plan(profile, plan, payload.goal, current_user.id),
        media_type="application/x-ndjson",
    )


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
