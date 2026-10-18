from datetime import datetime, date as date_type
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional


# --- Табель рабочего времени ---

class TimesheetEntryUpsert(BaseModel):
    date: date_type
    hours: Decimal = Field(default=Decimal("0"), ge=0, le=24, description="Основное время за день")
    overtime_hours: Decimal = Field(default=Decimal("0"), ge=0, le=24, description="Сверхурочное время за день")
    text_value: Optional[str] = Field(default=None, max_length=100, description="Текст вместо часов, например 'Больничный лист' или 'Отпуск'")
    comment: Optional[str] = None
    extra_approver_user_ids: list[int] = Field(
        default_factory=list,
        description="Дополнительные вышестоящие руководители, которых нужно включить в обязательное согласование помимо ближайшего",
    )
    extra_notify_user_ids: list[int] = Field(
        default_factory=list,
        description="Дополнительные вышестоящие руководители, которых нужно просто уведомить (без требования согласования)",
    )


class TimesheetReviewerBrief(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class TimesheetEntryReject(BaseModel):
    comment: str = Field(min_length=1, description="Комментарий обязателен при отклонении")


class TimesheetEntry(BaseModel):
    id: int
    user_id: int
    date: date_type
    hours: Decimal
    overtime_hours: Decimal = Decimal("0")
    text_value: Optional[str] = None
    comment: Optional[str] = None
    status: str = "approved"
    reviewer_id: Optional[int] = None
    reviewer: Optional[TimesheetReviewerBrief] = None
    reviewer_comment: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    submitted_at: Optional[datetime] = None
    approval_round: int = 0
    pending_approvers: list[TimesheetReviewerBrief] = Field(
        default_factory=list, description="Руководители, чьё согласование ещё требуется в текущем раунде"
    )
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class TimesheetApprovalEntry(BaseModel):
    """Один согласующий в рамках раунда согласования - кто и как согласовал/отклонил."""
    approver_id: Optional[int] = None
    approver: Optional[TimesheetReviewerBrief] = None
    status: str
    comment: Optional[str] = None
    decided_at: Optional[datetime] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class TimesheetApprovalRound(BaseModel):
    """
    Один блок истории карточки дня - событие отправки на согласование (или
    правки часов руководителем напрямую) и список того, кто и как согласовал
    в рамках этого же раунда.
    """
    round: int
    action: str
    actor_id: Optional[int] = None
    actor: Optional[TimesheetReviewerBrief] = None
    created_at: datetime
    approvals: list[TimesheetApprovalEntry] = Field(default_factory=list)
    model_config = ConfigDict(from_attributes=True)


class TimesheetEntryDetail(TimesheetEntry):
    """Карточка дня табеля с полной историей согласования, сгруппированной по раундам."""
    history: list[TimesheetApprovalRound] = Field(default_factory=list)


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
    hours: Optional[Decimal] = Field(default=None, description="Суммарные часы из табеля за этот день (основное + сверхурочное)")
    base_hours: Optional[Decimal] = Field(default=None, description="Основное время из табеля за этот день")
    overtime_hours: Optional[Decimal] = Field(default=None, description="Сверхурочное время из табеля за этот день")
    text_value: Optional[str] = Field(default=None, description="Текстовая отметка из табеля за этот день (например 'Больничный лист')")
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
    base_hours: Decimal = Decimal("0")
    overtime_hours: Decimal = Decimal("0")
    text_value: Optional[str] = None
    timesheet_status: Optional[str] = Field(default=None, description="Статус согласования часов за этот день")
    timesheet_entry_id: Optional[int] = None
    entry: Optional[ProductionEntry] = None


# --- Сводная таблица по подчинённым ---

class SubordinateDay(BaseModel):
    """Один день в сводной таблице подчинённого: часы из табеля + статус продукции."""
    date: date_type
    hours: Decimal = Decimal("0")
    base_hours: Decimal = Decimal("0")
    overtime_hours: Decimal = Decimal("0")
    text_value: Optional[str] = None
    status: Optional[str] = None
    entry_id: Optional[int] = None
    timesheet_status: Optional[str] = Field(default=None, description="Статус согласования часов за этот день")
    timesheet_entry_id: Optional[int] = None


class SubordinateSummary(BaseModel):
    """
    Строка сводной таблицы подчинённых вышестоящего пользователя: часы по
    каждому дню месяца и статусы сданной продукции, чтобы видеть всех
    подчинённых сразу и переходить к редактированию/согласованию.
    """
    user: EmployeeBrief
    days: list[SubordinateDay] = Field(default_factory=list)
    total_hours: Decimal = Decimal("0")
    pending_count: int = 0
    pending_timesheet_count: int = Field(default=0, description="Сколько дней с часами ожидают согласования руководителем")
