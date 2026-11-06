"""Финансовые данные sync и ответы финансовых API."""
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.journal.common import EntityData, JDate, OptStr, OptUUIDStr, UUIDStr


class FinanceCategoryData(EntityData):
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["expense", "income"]
    parent_uuid: OptUUIDStr = None
    icon: OptStr = Field(default=None, max_length=50)
    color: OptStr = Field(default=None, max_length=20)
    sort_order: int = Field(default=0, ge=-100000, le=100000)


class TransactionData(EntityData):
    category_uuid: OptUUIDStr = None
    transaction_date: JDate
    direction: Literal["expense", "income"]
    amount_kop: int = Field(gt=0, le=10**13)
    description: str = Field(default="", max_length=255)
    merchant: OptStr = Field(default=None, max_length=255)
    note: OptStr = Field(default=None, max_length=5000)
    external_id: OptStr = Field(default=None, max_length=255)
    review_required: bool = False
    source: Literal["manual", "import", "recurring"] = "manual"


class BudgetData(EntityData):
    category_uuid: OptUUIDStr = None
    period_month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    limit_kop: int = Field(gt=0, le=10**13)
    enabled: bool = True


class ImportProfileData(EntityData):
    name: str = Field(min_length=1, max_length=100)
    file_format: Literal["csv", "tsv", "xlsx"]
    header_fingerprint: str = Field(min_length=32, max_length=64)
    mapping: dict[str, Any] = Field(max_length=20)
    date_format: str | None = Field(default=None, max_length=40)
    delimiter: str | None = Field(default=None, max_length=4)


class ImportRuleData(EntityData):
    match_text: str = Field(min_length=1, max_length=200)
    match_field: Literal["description", "merchant"] = "description"
    category_uuid: OptUUIDStr = None
    priority: int = Field(default=100, ge=0, le=100000)
    enabled: bool = True


class ImportBatchData(EntityData):
    profile_uuid: OptUUIDStr = None
    filename: str = Field(min_length=1, max_length=255)
    content_fingerprint: str = Field(min_length=32, max_length=64)
    status: Literal["committed", "reverted"] = "committed"
    imported_count: int = Field(default=0, ge=0)
    duplicate_count: int = Field(default=0, ge=0)
    reverted_at: datetime | None = None




class CategoryTotal(BaseModel):
    category_uuid: str | None = None
    category_name: str
    amount_kop: int
    transactions: int


class FinanceSummary(BaseModel):
    date_from: date
    date_to: date
    income_kop: int
    expense_kop: int
    net_kop: int
    by_category: list[CategoryTotal]
    by_month: list[dict[str, int | str]]


class ReviewQueueResponse(BaseModel):
    items: list[dict[str, Any]]
    total: int


class ImportPreviewResponse(BaseModel):
    preview_token: str
    filename: str
    file_format: str
    headers: list[str]
    header_fingerprint: str
    suggested_mapping: dict[str, int | None]
    rows: list[dict[str, Any]]
    row_count: int
    warnings: list[str] = Field(default_factory=list)


class ImportCommitRequest(BaseModel):
    preview_token: str
    mapping: dict[str, int] = Field(max_length=20)
    date_format: str | None = Field(default=None, max_length=40)
    profile_name: str | None = Field(default=None, max_length=100)


class ImportCommitResponse(BaseModel):
    batch_uuid: str
    imported_count: int
    duplicate_count: int
    review_count: int


class ImportBatchOut(BaseModel):
    uuid: str
    filename: str
    status: str
    imported_count: int
    duplicate_count: int
    created_at: datetime
    reverted_at: datetime | None = None


class CategorySuggestionRequest(BaseModel):
    descriptions: list[str] = Field(min_length=1, max_length=50)

    @field_validator("descriptions")
    @classmethod
    def trim_descriptions(cls, values: list[str]) -> list[str]:
        trimmed = [value.strip()[:255] for value in values]
        if any(not value for value in trimmed):
            raise ValueError("Описание операции не может быть пустым")
        return trimmed


class CategorySuggestion(BaseModel):
    description: str
    category_uuid: str | None = None
    category_name: str | None = None
    confidence: float = Field(ge=0, le=1)


class CategorySuggestionResponse(BaseModel):
    suggestions: list[CategorySuggestion]
