from datetime import datetime, date as date_type
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional


# --- Табель рабочего времени ---

class TimesheetEntryUpsert(BaseModel):
    date: date_type
    hours: Decimal = Field(ge=0, le=24)
    comment: Optional[str] = None


class TimesheetEntry(BaseModel):
    id: int
    user_id: int
    date: date_type
    hours: Decimal
    comment: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class TimesheetMonthRequest(BaseModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)


# --- Справочник продукции ---

class ProductBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code: Optional[str] = Field(default=None, max_length=100)
    unit: str = Field(default="шт", max_length=50)
    is_active: bool = True


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    code: Optional[str] = Field(default=None, max_length=100)
    unit: Optional[str] = Field(default=None, max_length=50)
    is_active: Optional[bool] = None


class Product(ProductBase):
    id: int
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


# --- Позиции сданной продукции ---

class ProductionEntryItemCreate(BaseModel):
    product_id: int
    quantity: Decimal = Field(ge=0)
    comment: Optional[str] = None

    @field_validator("quantity")
    @classmethod
    def quantity_non_negative(cls, v: Decimal) -> Decimal:
        if v < 0:
            raise ValueError("Количество продукции должно быть больше или равно 0")
        return v


class ProductionEntryItem(BaseModel):
    id: int
    product_id: int
    product: Optional[Product] = None
    quantity: Decimal
    comment: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


# --- Дневная запись о сданной продукции ---

class ProductionEntryUpsert(BaseModel):
    """Создание/обновление записи о сданной продукции за один день."""
    date: date_type
    items: list[ProductionEntryItemCreate] = Field(default_factory=list)


class ProductionEntryReject(BaseModel):
    comment: str = Field(min_length=1, description="Комментарий обязателен при отклонении")


class EmployeeBrief(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: str
    avatar_url: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class ProductionAuditLogEntry(BaseModel):
    id: int
    action: str
    actor_id: Optional[int] = None
    actor: Optional[EmployeeBrief] = None
    comment: Optional[str] = None
    old_values: Optional[dict] = None
    new_values: Optional[dict] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ProductionEntry(BaseModel):
    id: int
    user_id: int
    user: Optional[EmployeeBrief] = None
    date: date_type
    status: str
    hours: Optional[Decimal] = Field(default=None, description="Часы из табеля за этот день")
    items: list[ProductionEntryItem] = Field(default_factory=list)
    reviewer_id: Optional[int] = None
    reviewer: Optional[EmployeeBrief] = None
    reviewer_comment: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    submitted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    can_edit: bool = False
    model_config = ConfigDict(from_attributes=True)


class ProductionEntryDetail(ProductionEntry):
    logs: list[ProductionAuditLogEntry] = Field(default_factory=list)


class DayTimesheetInfo(BaseModel):
    """Один день в таблице вкладки 'Количество сданной продукции'."""
    date: date_type
    hours: Decimal = Decimal("0")
    entry: Optional[ProductionEntry] = None
