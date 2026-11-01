"""
Расчёт нормы калорий и БЖУ по ответам анкеты (формула Миффлина–Сан Жеора).
Значения считаются детерминированно; ИИ используется только для текстовых советов.
"""
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal

from pydantic import BaseModel, Field

ACTIVITY_FACTORS = {
    "sedentary": Decimal("1.2"),
    "light": Decimal("1.375"),
    "moderate": Decimal("1.55"),
    "active": Decimal("1.725"),
    "very_active": Decimal("1.9"),
}

# Поправка к поддерживающей норме: дефицит или профицит калорий
GOAL_ADJUSTMENTS = {
    "lose": Decimal("-300"),
    "maintain": Decimal("0"),
    "gain": Decimal("300"),
}

# Доли калорий от нормы: белки, жиры, углеводы (в %)
MACRO_SPLITS = {
    "lose": (Decimal("30"), Decimal("30"), Decimal("40")),
    "maintain": (Decimal("25"), Decimal("30"), Decimal("45")),
    "gain": (Decimal("25"), Decimal("25"), Decimal("50")),
}


class NutritionPlanInput(BaseModel):
    sex: Literal["male", "female"]
    age: int = Field(ge=14, le=100)
    height_cm: int = Field(ge=120, le=230)
    weight_kg: float = Field(ge=30, le=300)
    activity: Literal["sedentary", "light", "moderate", "active", "very_active"]
    goal: Literal["lose", "maintain", "gain"]


class NutritionPlanResult(BaseModel):
    bmr_kcal: int
    tdee_kcal: int
    kcal: int
    protein_g: int
    fat_g: int
    carbs_g: int


class NutritionPlanResponse(BaseModel):
    plan: NutritionPlanResult
    advice: str


def _round_int(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def calculate_plan(data: NutritionPlanInput) -> NutritionPlanResult:
    weight = Decimal(str(data.weight_kg))
    height = Decimal(data.height_cm)
    base = Decimal(10) * weight + Decimal("6.25") * height - Decimal(5) * data.age
    bmr = base + (Decimal(5) if data.sex == "male" else Decimal(-161))
    tdee = bmr * ACTIVITY_FACTORS[data.activity]
    kcal = max(tdee + GOAL_ADJUSTMENTS[data.goal], Decimal(1200))
    protein_pct, fat_pct, carbs_pct = MACRO_SPLITS[data.goal]
    return NutritionPlanResult(
        bmr_kcal=_round_int(bmr),
        tdee_kcal=_round_int(tdee),
        kcal=_round_int(kcal),
        protein_g=_round_int(kcal * protein_pct / 100 / Decimal(4)),
        fat_g=_round_int(kcal * fat_pct / 100 / Decimal(9)),
        carbs_g=_round_int(kcal * carbs_pct / 100 / Decimal(4)),
    )
