"""Схемы целей журнала (фаза 4) для sync-контракта и API прогресса."""
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.journal.common import EntityData, JDate, JNumber, OptJDate, OptStr

GoalSourceType = Literal[
    "tracker", "weight", "water", "kcal", "protein", "fat", "carbs", "expense_total", "expense_category",
]


class GoalData(EntityData):
    title: str = Field(min_length=1, max_length=200)
    source_type: GoalSourceType
    source_uuid: OptStr = Field(default=None, max_length=36)
    target_value: Decimal
    start_value: JNumber = None
    period: Literal["none", "day", "week", "month"] = "none"
    start_date: JDate
    deadline: OptJDate = None
    direction: Literal["reach", "not_exceed"] = "reach"
    status: Literal["active", "achieved", "failed", "archived"] = "active"

    @model_validator(mode="after")
    def check_consistency(self):
        if self.deadline is not None and self.deadline < self.start_date:
            raise ValueError("Срок цели раньше даты начала")
        return self


class WeeklySummaryResponse(BaseModel):
    date_from: date
    date_to: date
    summary: str


class GoalProgress(BaseModel):
    goal_uuid: str
    title: str
    source_type: str
    current: float
    target: float
    percent: float
    achieved: bool
    period_start: date | None = None
    period_end: date | None = None
