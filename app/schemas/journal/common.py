"""Общие типы и валидаторы схем журнала."""
import json
import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, ConfigDict

MIN_DATE = date(1970, 1, 1)
MAX_DATE = date(2100, 12, 31)
MAX_ABS_NUMBER = Decimal("9999999999")


def _check_date(value: date | None) -> date | None:
    if value is not None and not (MIN_DATE <= value <= MAX_DATE):
        raise ValueError("Дата должна быть в диапазоне 1970-2100")
    return value


def _check_uuid(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError, TypeError):
        raise ValueError("Некорректный UUID")


def _check_number(value: Decimal | None) -> Decimal | None:
    if value is not None:
        if not value.is_finite() or abs(value) > MAX_ABS_NUMBER:
            raise ValueError("Число вне допустимого диапазона")
    return value


def _strip_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


JDate = Annotated[date, AfterValidator(_check_date)]
OptJDate = Annotated[date | None, AfterValidator(_check_date)]
UUIDStr = Annotated[str, AfterValidator(_check_uuid)]
OptUUIDStr = Annotated[str | None, AfterValidator(_check_uuid)]
JNumber = Annotated[Decimal | None, AfterValidator(_check_number)]
OptStr = Annotated[str | None, AfterValidator(_strip_or_none)]


def json_size(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False, default=str))


class EntityData(BaseModel):
    """База для данных сущностей sync: лишние поля игнорируются, строки обрезаются."""
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
