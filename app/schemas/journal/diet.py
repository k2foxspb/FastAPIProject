"""
Схемы диеты журнала: данные сущностей sync (типы приёмов пищи, продукты,
ингредиенты рецептов, записи о еде и воде) и ответы эндпоинтов диеты и ИИ.
"""
import datetime as dt
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, Field, field_validator, model_validator

from app.schemas.journal.common import EntityData, JDate, OptStr, OptUUIDStr, UUIDStr


def _round2(value: Decimal | None) -> Decimal | None:
    """Округление до сотых (колонки Numeric(*, 2)); клиент может прислать больше знаков."""
    if value is None:
        return None
    if not value.is_finite():
        raise ValueError("Число вне допустимого диапазона")
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# КБЖУ на 100 г (дополнительно: не больше 100 г нутриента и 900 ккал - см. FoodData)
Per100 = Annotated[Decimal, Field(ge=0, le=1000), AfterValidator(_round2)]
Grams = Annotated[Decimal, Field(gt=0, le=100000), AfterValidator(_round2)]
Amount = Annotated[Decimal, Field(ge=0, le=100000), AfterValidator(_round2)]


# ---------------------------------------------------------------- данные сущностей sync

class MealTypeData(EntityData):
    name: str = Field(min_length=1, max_length=100)
    default_time: dt.time | None = None
    icon: OptStr = Field(default=None, max_length=50)
    sort_order: int = Field(default=0, ge=-100000, le=100000)
    reminder_enabled: bool = False

    @model_validator(mode="after")
    def check_consistency(self):
        if self.reminder_enabled and self.default_time is None:
            raise ValueError("Для напоминания нужно время приёма пищи")
        return self


class FoodData(EntityData):
    name: str = Field(min_length=1, max_length=200)
    brand: OptStr = Field(default=None, max_length=100)
    kcal_100: Per100 = Decimal(0)
    protein_100: Per100 = Decimal(0)
    fat_100: Per100 = Decimal(0)
    carbs_100: Per100 = Decimal(0)
    serving_g: Grams | None = None
    barcode: OptStr = Field(default=None, max_length=32)
    source: Literal["manual", "ai", "off", "recipe"] = "manual"
    is_recipe: bool = False
    recipe_yield_g: Grams | None = None
    use_count: int = Field(default=0, ge=0, le=10_000_000)
    last_used_at: dt.datetime | None = None

    @field_validator("barcode")
    @classmethod
    def validate_barcode(cls, v: str | None) -> str | None:
        if v is not None and not v.isdigit():
            raise ValueError("Штрихкод должен состоять из цифр")
        return v

    @model_validator(mode="after")
    def check_consistency(self):
        for name in ("protein_100", "fat_100", "carbs_100"):
            if getattr(self, name) > 100:
                raise ValueError("Нутриентов не может быть больше 100 г на 100 г")
        if self.kcal_100 > 900:
            raise ValueError("Калорийность не может быть больше 900 ккал на 100 г")
        if not self.is_recipe:
            self.recipe_yield_g = None
        return self


class RecipeItemData(EntityData):
    recipe_uuid: UUIDStr
    ingredient_uuid: UUIDStr
    grams: Grams

    @model_validator(mode="after")
    def check_consistency(self):
        if self.recipe_uuid == self.ingredient_uuid:
            raise ValueError("Рецепт не может входить сам в себя")
        return self


class FoodEntryData(EntityData):
    entry_date: JDate
    entry_time: dt.time | None = None
    meal_type_uuid: OptUUIDStr = None
    food_uuid: OptUUIDStr = None
    name: str = Field(min_length=1, max_length=200)
    grams: Grams
    kcal: Amount = Decimal(0)
    protein: Amount = Decimal(0)
    fat: Amount = Decimal(0)
    carbs: Amount = Decimal(0)
    note: OptStr = Field(default=None, max_length=500)


class WaterEntryData(EntityData):
    entry_date: JDate
    entry_time: dt.time
    amount_ml: int = Field(ge=1, le=5000)


# ---------------------------------------------------------------- эндпоинты диеты

class FoodOut(BaseModel):
    client_uuid: str
    name: str
    brand: str | None = None
    kcal_100: float
    protein_100: float
    fat_100: float
    carbs_100: float
    serving_g: float | None = None
    barcode: str | None = None
    source: str
    is_recipe: bool
    use_count: int
    last_used_at: dt.datetime | None = None


class FoodSearchResponse(BaseModel):
    items: list[FoodOut]
    page: int
    has_more: bool


class DietDayTotals(BaseModel):
    date: dt.date
    kcal: float = 0
    protein: float = 0
    fat: float = 0
    carbs: float = 0
    water_ml: int = 0
    entries: int = 0


class DietGoals(BaseModel):
    kcal: int | None = None
    protein: int | None = None
    fat: int | None = None
    carbs: int | None = None
    water_ml: int | None = None


class DietSummaryResponse(BaseModel):
    date_from: dt.date
    date_to: dt.date
    days: list[DietDayTotals]
    total: DietDayTotals
    average: DietDayTotals
    goals: DietGoals


# ---------------------------------------------------------------- ИИ-оценка КБЖУ

class EstimateNutritionRequest(BaseModel):
    text: str = Field(min_length=2, max_length=1000)

    @field_validator("text")
    @classmethod
    def strip_text(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Опишите, что вы съели")
        return v


class AiNutritionItem(BaseModel):
    """Позиция из ответа модели (строгая проверка диапазонов)."""
    name: str = Field(min_length=1, max_length=200)
    grams: float = Field(gt=0, le=5000)
    kcal: float = Field(ge=0, le=10000)
    protein: float = Field(ge=0, le=1000)
    fat: float = Field(ge=0, le=1000)
    carbs: float = Field(ge=0, le=1000)

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Пустое название")
        return v


class AiNutritionAnswer(BaseModel):
    items: list[AiNutritionItem] = Field(min_length=1, max_length=30)


class EstimatedItem(BaseModel):
    name: str
    grams: float
    kcal: float
    protein: float
    fat: float
    carbs: float
    # Значения на 100 г - для сохранения в личную базу продуктов
    kcal_100: float
    protein_100: float
    fat_100: float
    carbs_100: float


class EstimateNutritionResponse(BaseModel):
    items: list[EstimatedItem]
    total: dict[str, Any]
    disclaimer: str = "Оценка приблизительная - проверьте и поправьте значения перед сохранением."
