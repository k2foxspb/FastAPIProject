"""
ИИ-функции журнала (через общий клиент Ollama). ИИ только предлагает значения:
пользователь подтверждает или правит их перед сохранением, поэтому здесь
ничего не записывается в БД.
"""
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ollama
from app.schemas.journal.diet import AiNutritionAnswer, EstimatedItem, EstimateNutritionResponse
from app.models.journal import JournalFinanceCategory
from app.schemas.journal.finance import CategorySuggestion, CategorySuggestionResponse
from app.services.journal.nutrition import NUTRIENTS, round2
from app.services.journal.nutrition_plan import NutritionPlanInput, NutritionPlanResult

AI_TIMEOUT_SEC = 60.0

NUTRITION_SYSTEM_PROMPT = (
    "Ты нутрициолог. Пользователь описывает, что он съел. Оцени массу каждой позиции в граммах "
    "и её калорийность и БЖУ (для всей порции, не на 100 г), опираясь на типичные значения "
    "для блюд русской и европейской кухни. Если масса не указана - возьми типичную порцию "
    "(например, тарелка супа 300 г, кусок хлеба 30 г). Названия пиши по-русски, коротко.\n"
    "Отвечай ТОЛЬКО JSON без пояснений в формате:\n"
    '{"items": [{"name": "Борщ", "grams": 300, "kcal": 150, "protein": 7, "fat": 6, "carbs": 18}]}\n'
    "Все числа - неотрицательные, protein/fat/carbs - в граммах."
)


def build_estimate(answer: AiNutritionAnswer) -> EstimateNutritionResponse:
    """Нормализует ответ модели: округление, значения на 100 г, итог."""
    items: list[EstimatedItem] = []
    totals = {name: Decimal(0) for name in NUTRIENTS}
    grams_total = Decimal(0)
    for item in answer.items:
        grams = round2(item.grams)
        values = {name: round2(getattr(item, name)) for name in NUTRIENTS}
        per100 = {f"{name}_100": float(round2(values[name] * 100 / grams)) for name in NUTRIENTS}
        # На 100 г не бывает больше 900 ккал и 100 г нутриента - явная ошибка модели
        if per100["kcal_100"] > 900 or any(per100[f"{n}_100"] > 100 for n in ("protein", "fat", "carbs")):
            raise ollama.OllamaBadResponse("ИИ вернул неправдоподобные значения - уточните описание")
        items.append(EstimatedItem(
            name=item.name[:200], grams=float(grams), **{k: float(v) for k, v in values.items()}, **per100,
        ))
        grams_total += grams
        for name in NUTRIENTS:
            totals[name] += values[name]
    total = {name: float(round2(value)) for name, value in totals.items()}
    total["grams"] = float(round2(grams_total))
    return EstimateNutritionResponse(items=items, total=total)


async def estimate_nutrition(text: str) -> EstimateNutritionResponse:
    messages = [
        {"role": "system", "content": NUTRITION_SYSTEM_PROMPT},
        {"role": "user", "content": text},
    ]
    answer = await ollama.chat_json(messages, AiNutritionAnswer, timeout=AI_TIMEOUT_SEC, options={"temperature": 0.1})
    return build_estimate(answer)


class WeeklySummaryAnswer(BaseModel):
    summary: str = Field(min_length=1, max_length=1500)


WEEKLY_SUMMARY_SYSTEM_PROMPT = (
    "Ты помощник по личному журналу. По итогам недели (питание, вода) напиши короткую дружелюбную "
    "сводку на русском: 3-5 предложений, без медицинских советов, без выдуманных цифр. "
    "Ответь ТОЛЬКО JSON в формате: {\"summary\": \"текст\"}."
)


async def weekly_summary(db: AsyncSession, user_id: int, date_from: date, date_to: date) -> str:
    """Текст сводки за неделю по данным питания и воды; при пустой неделе ИИ не вызывается."""
    from app.services.journal import nutrition

    diet = await nutrition.diet_summary(db, user_id, date_from, date_to)
    if diet.total.entries == 0 and diet.total.water_ml == 0:
        return "На этой неделе записей о питании и воде не было."
    facts = {
        "period": f"{date_from.isoformat()} - {date_to.isoformat()}",
        "days_with_entries": sum(1 for day in diet.days if day.entries or day.water_ml),
        "average_kcal": diet.average.kcal,
        "average_protein": diet.average.protein,
        "average_water_ml": diet.average.water_ml,
        "goals": diet.goals.model_dump(),
    }
    messages = [
        {"role": "system", "content": WEEKLY_SUMMARY_SYSTEM_PROMPT},
        {"role": "user", "content": str(facts)},
    ]
    answer = await ollama.chat_json(messages, WeeklySummaryAnswer, timeout=AI_TIMEOUT_SEC, options={"temperature": 0.3})
    return answer.summary


NUTRITION_ADVICE_SYSTEM_PROMPT = (
    "Ты помощник по питанию в личном журнале. Пользователю рассчитана формульная норма калорий "
    "(kcal) и БЖУ по его данным. Скорректируй калории не более чем на 15% от kcal с учётом цели и "
    "активности и предложи распределение БЖУ в процентах от калорий (белки 10-35, жиры 20-35, "
    "углеводы 40-65, сумма 100). Напиши 3-5 коротких практических советов на русском: как распределить "
    "питание по приёмам пищи и на что обратить внимание. Не ставь диагнозов и не давай медицинских назначений. "
    "Ответь ТОЛЬКО JSON в формате: {\"kcal\": число, \"protein_pct\": число, \"fat_pct\": число, \"carbs_pct\": число, \"advice\": \"текст\"}."
)


class NutritionAdviceAnswer(BaseModel):
    kcal: int = Field(ge=800, le=6000)
    protein_pct: int = Field(ge=0, le=100)
    fat_pct: int = Field(ge=0, le=100)
    carbs_pct: int = Field(ge=0, le=100)
    advice: str = Field(min_length=1, max_length=2000)


async def nutrition_advice(payload: NutritionPlanInput, plan: NutritionPlanResult) -> NutritionAdviceAnswer:
    """ИИ-корректировка формульной нормы КБЖУ и текстовые рекомендации."""
    facts = {
        "sex": payload.sex,
        "age": payload.age,
        "height_cm": payload.height_cm,
        "weight_kg": payload.weight_kg,
        "activity": payload.activity,
        "goal": payload.goal,
        "kcal": plan.kcal,
        "protein_g": plan.protein_g,
        "fat_g": plan.fat_g,
        "carbs_g": plan.carbs_g,
    }
    messages = [
        {"role": "system", "content": NUTRITION_ADVICE_SYSTEM_PROMPT},
        {"role": "user", "content": str(facts)},
    ]
    answer = await ollama.chat_json(messages, NutritionAdviceAnswer, timeout=AI_TIMEOUT_SEC, options={"temperature": 0.3})
    return answer


class CategoryAnswerItem(BaseModel):
    index: int = Field(ge=0, le=49)
    category_name: str
    confidence: float = Field(ge=0, le=1)


class CategoryAnswer(BaseModel):
    items: list[CategoryAnswerItem] = Field(max_length=50)


async def suggest_categories(db: AsyncSession, user_id: int, descriptions: list[str]) -> CategorySuggestionResponse:
    categories = (await db.execute(select(JournalFinanceCategory).where(
        JournalFinanceCategory.user_id == user_id, JournalFinanceCategory.deleted_at.is_(None),
        JournalFinanceCategory.kind == "expense",
    ).order_by(JournalFinanceCategory.sort_order, JournalFinanceCategory.name))).scalars().all()
    if not categories:
        return CategorySuggestionResponse(suggestions=[
            CategorySuggestion(description=text, confidence=0) for text in descriptions
        ])
    allowed = [category.name for category in categories]
    messages = [
        {"role": "system", "content": (
            "Подбери наиболее вероятную категорию расхода для каждой операции. "
            "Используй только названия из списка категорий. Ответь только JSON: "
            '{"items":[{"index":0,"category_name":"Продукты","confidence":0.8}]}'
        )},
        {"role": "user", "content": f"Категории: {allowed}\nОперации: {descriptions}"},
    ]
    answer = await ollama.chat_json(messages, CategoryAnswer, timeout=AI_TIMEOUT_SEC, options={"temperature": 0.1})
    by_name = {category.name.casefold(): category for category in categories}
    by_index = {item.index: item for item in answer.items if item.index < len(descriptions)}
    result = []
    for index, description in enumerate(descriptions):
        item = by_index.get(index)
        category = by_name.get(item.category_name.casefold()) if item else None
        result.append(CategorySuggestion(
            description=description,
            category_uuid=category.client_uuid if category else None,
            category_name=category.name if category else None,
            confidence=item.confidence if category and item else 0,
        ))
    return CategorySuggestionResponse(suggestions=result)
