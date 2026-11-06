"""
ИИ-аналитика журнала по сферам: питание, финансы, вес и рост, трекеры.
Факты считаются на сервере из БД (ИИ не придумывает цифры), модель только
формулирует выводы и рекомендации. Ничего не записывается в БД.
"""
import json
from datetime import date

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ollama
from app.models.journal import JournalTracker, JournalTrackerValue
from app.schemas.journal.analysis import AnalysisResponse, AnalysisSection
from app.services.journal import finance, nutrition

AI_TIMEOUT_SEC = 90.0

AREA_TITLES = {"food": "Питание", "finance": "Финансы", "body": "Вес и рост", "trackers": "Трекеры"}
# Названия трекеров, которые считаются параметрами тела (сопоставляются без учёта регистра)
BODY_TRACKER_NAMES = {"вес": "weight", "рост": "height"}

ANALYSIS_SYSTEM_PROMPT = (
    "Ты аналитик личного журнала. Тебе передают факты за период по разделам журнала "
    "(питание, финансы, вес и рост, трекеры). Для каждого раздела, который есть в фактах, "
    "напиши краткий вывод на русском (2-4 предложения) и до 3 конкретных рекомендаций. "
    "Опирайся только на переданные числа, ничего не выдумывай. Если данных мало, так и скажи. "
    "Не ставь диагнозов и не давай медицинских назначений; по вопросам здоровья советуй врача. "
    "Ответь ТОЛЬКО JSON в формате: "
    '{"sections": [{"area": "food", "summary": "текст", "recommendations": ["совет"]}]}. '
    "Допустимые area: food, finance, body, trackers."
)


MAX_SUMMARY_LEN = 800
MAX_RECOMMENDATIONS = 3
MAX_RECOMMENDATION_LEN = 300
ANALYSIS_UNAVAILABLE_MESSAGE = "ИИ не смог сформулировать вывод по данным за период. Попробуйте повторить позже."


def _parse_answer(text: str) -> list[dict]:
    # Разбор терпимый: лишние секции и рекомендации отбрасываются или обрезаются, а не ломают весь ответ
    value = ollama.extract_json(text)
    if isinstance(value, list):
        value = {"sections": value}
    if not isinstance(value, dict) or not isinstance(value.get("sections"), list):
        raise ollama.OllamaBadResponse("ИИ вернул некорректный ответ")
    sections = []
    for item in value["sections"]:
        if not isinstance(item, dict):
            continue
        area = str(item.get("area", "")).strip()
        summary = str(item.get("summary", "")).strip()[:MAX_SUMMARY_LEN]
        raw_recs = item.get("recommendations") or []
        if isinstance(raw_recs, str):
            raw_recs = [raw_recs]
        if not isinstance(raw_recs, list):
            raw_recs = []
        recommendations = [str(r).strip()[:MAX_RECOMMENDATION_LEN] for r in raw_recs if str(r).strip()]
        if area in AREA_TITLES and summary:
            sections.append({"area": area, "summary": summary, "recommendations": recommendations[:MAX_RECOMMENDATIONS]})
    return sections


def _food_facts(diet) -> dict | None:
    if diet.total.entries == 0 and diet.total.water_ml == 0:
        return None
    days_total = len(diet.days)
    return {
        "days_in_period": days_total,
        "days_with_entries": sum(1 for day in diet.days if day.entries),
        "average_per_day": {
            "kcal": diet.average.kcal,
            "protein_g": diet.average.protein,
            "fat_g": diet.average.fat,
            "carbs_g": diet.average.carbs,
            "water_ml": diet.average.water_ml,
        },
        "goals_per_day": diet.goals.model_dump(),
        "entries_total": diet.total.entries,
    }


def _finance_facts(summary) -> dict | None:
    if summary.income_kop == 0 and summary.expense_kop == 0:
        return None
    return {
        "income_kop": summary.income_kop,
        "expense_kop": summary.expense_kop,
        "net_kop": summary.net_kop,
        "top_expense_categories": [
            {"name": item.category_name, "amount_kop": item.amount_kop, "transactions": item.transactions}
            for item in summary.by_category[:5]
        ],
    }


def _normalize_height_cm(value: float) -> float:
    # Рост могут вводить в метрах (1.75) или сантиметрах (175)
    return value * 100 if value < 3 else value


def _body_facts(body: dict[str, JournalTracker], series: dict[int, list], start: date, end: date) -> dict | None:
    result = {}
    weight = body.get("weight")
    weight_points = [(d, v) for d, v in series.get(weight.id, []) if start <= d <= end] if weight else []
    if weight_points:
        first, last = weight_points[0][1], weight_points[-1][1]
        result["weight"] = {
            "unit": weight.unit or "кг", "first": first, "last": last,
            "change": round(last - first, 1), "measurements": len(weight_points),
        }
    height = body.get("height")
    height_points = series.get(height.id, []) if height else []
    if height_points:
        height_cm = _normalize_height_cm(height_points[-1][1])
        result["height_cm"] = round(height_cm, 1)
        if weight_points:
            meters = height_cm / 100
            result["bmi_last"] = round(weight_points[-1][1] / (meters * meters), 1)
    return result or None


def _other_trackers_facts(trackers: list[JournalTracker], series: dict[int, list], start: date, end: date) -> dict | None:
    items = []
    for tracker in trackers:
        points = [(d, v) for d, v in series.get(tracker.id, []) if start <= d <= end]
        if not points:
            continue
        values = [v for _, v in points]
        item = {
            "name": tracker.name, "unit": tracker.unit or "", "measurements": len(values),
            "first": values[0], "last": values[-1], "average": round(sum(values) / len(values), 2),
        }
        if tracker.goal_value is not None:
            item["goal"] = float(tracker.goal_value)
            item["goal_direction"] = tracker.goal_direction or "reach"
        items.append(item)
    return {"trackers": items} if items else None


async def _load_trackers(db: AsyncSession, user_id: int) -> tuple[list[JournalTracker], dict[int, list]]:
    trackers = (await db.execute(select(JournalTracker).where(
        JournalTracker.user_id == user_id, JournalTracker.deleted_at.is_(None),
        JournalTracker.value_type != "text",
    ))).scalars().all()
    series: dict[int, list] = {}
    if not trackers:
        return trackers, series
    rows = (await db.execute(select(
        JournalTrackerValue.tracker_id, JournalTrackerValue.value_date, JournalTrackerValue.num_value,
    ).where(
        JournalTrackerValue.user_id == user_id, JournalTrackerValue.deleted_at.is_(None),
        JournalTrackerValue.tracker_id.in_([t.id for t in trackers]),
        JournalTrackerValue.num_value.is_not(None),
    ).order_by(JournalTrackerValue.value_date))).all()
    for tracker_id, value_date, num in rows:
        series.setdefault(tracker_id, []).append((value_date, float(num)))
    return trackers, series


async def collect_facts(db: AsyncSession, user_id: int, start: date, end: date, areas: list[str]) -> dict:
    facts: dict = {}
    if "food" in areas:
        food = _food_facts(await nutrition.diet_summary(db, user_id, start, end))
        if food:
            facts["food"] = food
    if "finance" in areas:
        finance_facts = _finance_facts(await finance.finance_summary(db, user_id, start, end))
        if finance_facts:
            facts["finance"] = finance_facts
    if "body" in areas or "trackers" in areas:
        trackers, series = await _load_trackers(db, user_id)
        body = {BODY_TRACKER_NAMES[t.name.strip().casefold()]: t for t in trackers
                if t.name.strip().casefold() in BODY_TRACKER_NAMES}
        if "body" in areas:
            body_facts = _body_facts(body, series, start, end)
            if body_facts:
                facts["body"] = body_facts
        if "trackers" in areas:
            other = [t for t in trackers if t.id not in {b.id for b in body.values()}]
            trackers_facts = _other_trackers_facts(other, series, start, end)
            if trackers_facts:
                facts["trackers"] = trackers_facts
    return facts


async def analyze(db: AsyncSession, user_id: int, start: date, end: date, areas: list[str]) -> AnalysisResponse:
    facts = await collect_facts(db, user_id, start, end, areas)
    if not facts:
        return AnalysisResponse(date_from=start, date_to=end, message="За период нет данных для анализа.")
    messages = [
        {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps({"period": f"{start.isoformat()} - {end.isoformat()}", **facts},
                                               ensure_ascii=False)},
    ]
    text = await ollama.chat(messages, timeout=AI_TIMEOUT_SEC, options={"temperature": 0.3}, json_mode=True)
    try:
        parsed = _parse_answer(text)
    except ollama.OllamaBadResponse as e:
        logger.warning(f"Journal AI analysis: некорректный ответ модели: {e.message}")
        return AnalysisResponse(date_from=start, date_to=end, message=ANALYSIS_UNAVAILABLE_MESSAGE)
    sections = [
        AnalysisSection(area=item["area"], title=AREA_TITLES[item["area"]], summary=item["summary"],
                        recommendations=item["recommendations"])
        for item in parsed if item["area"] in facts
    ]
    if not sections:
        return AnalysisResponse(date_from=start, date_to=end, message=ANALYSIS_UNAVAILABLE_MESSAGE)
    return AnalysisResponse(date_from=start, date_to=end, sections=sections)
