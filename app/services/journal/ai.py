"""
ИИ-функции журнала (через общий клиент Ollama). ИИ только предлагает значения:
пользователь подтверждает или правит их перед сохранением, поэтому здесь
ничего не записывается в БД.
"""
from decimal import Decimal

from app.core import ollama
from app.schemas.journal.diet import AiNutritionAnswer, EstimatedItem, EstimateNutritionResponse
from app.services.journal.nutrition import NUTRIENTS, round2

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
