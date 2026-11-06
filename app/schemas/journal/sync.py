"""
Схемы синхронизации журнала: контракт push/pull и данные сущностей.

Все CRUD-операции журнала идут через POST /api/journal/sync/push; поле `data`
каждого изменения валидируется схемой сущности из этого модуля. Ссылки на
другие сущности передаются только как *_uuid (client_uuid владельца).
"""
from datetime import datetime, time
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.journal.common import (
    EntityData, JDate, JNumber, OptJDate, OptStr, OptUUIDStr, UUIDStr, json_size,
)
from app.services.journal.recurrence import format_rrule, is_valid_timezone, parse_rrule


def _normalize_rrule(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return format_rrule(parse_rrule(value))


# ---------------------------------------------------------------- контракт sync

class SyncChange(BaseModel):
    entity: str = Field(min_length=1, max_length=40)
    client_uuid: UUIDStr
    op: Literal["upsert", "delete"]
    updated_at: datetime
    data: dict[str, Any] | None = None


class SyncPushRequest(BaseModel):
    device_id: str | None = Field(default=None, max_length=100)
    changes: list[SyncChange]


class SyncResult(BaseModel):
    entity: str
    client_uuid: str
    status: Literal["applied", "stale", "rejected"]
    reason: str | None = None
    server_rev: int | None = None
    current: dict[str, Any] | None = None


class SyncPushResponse(BaseModel):
    results: list[SyncResult]
    cursor: int


class SyncPullChange(BaseModel):
    entity: str
    client_uuid: str
    server_rev: int
    deleted_at: datetime | None = None
    data: dict[str, Any] | None = None


class SyncPullResponse(BaseModel):
    changes: list[SyncPullChange]
    cursor: int
    has_more: bool


class SyncMetaResponse(BaseModel):
    user_id: int
    seed_namespace: str
    entities: list[str]
    max_changes: int
    max_bytes: int
    pull_max_limit: int
    tracker_templates: list[dict[str, Any]]


# ---------------------------------------------------------------- данные сущностей

class SettingsData(EntityData):
    timezone: str = Field(default="Europe/Moscow", max_length=64)
    week_start: int = Field(default=1, ge=1, le=7)
    kcal_goal: int | None = Field(default=None, ge=0, le=20000)
    protein_g_goal: int | None = Field(default=None, ge=0, le=2000)
    fat_g_goal: int | None = Field(default=None, ge=0, le=2000)
    carbs_g_goal: int | None = Field(default=None, ge=0, le=5000)
    water_ml_goal: int | None = Field(default=None, ge=0, le=20000)
    seed_version: int = Field(default=0, ge=0, le=1000)

    @field_validator("timezone")
    @classmethod
    def validate_tz(cls, v: str) -> str:
        if not is_valid_timezone(v):
            raise ValueError("Неизвестный часовой пояс")
        return v


class EventData(EntityData):
    kind: Literal["meal", "payment", "note", "tracker", "custom"]
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    start_date: JDate
    start_time: time | None = None
    timezone: str | None = Field(default=None, max_length=64)
    duration_min: int | None = Field(default=None, ge=0, le=44640)
    rrule: str | None = Field(default=None, max_length=255)
    until_date: OptJDate = None
    status: Literal["planned", "done", "skipped"] = "planned"
    ref_type: Literal["tracker"] | None = None
    ref_uuid: OptUUIDStr = None
    payload: dict[str, Any] | None = None
    color: OptStr = Field(default=None, max_length=20)

    @field_validator("rrule")
    @classmethod
    def validate_rrule(cls, v: str | None) -> str | None:
        return _normalize_rrule(v)

    @field_validator("timezone")
    @classmethod
    def validate_tz(cls, v: str | None) -> str | None:
        if v and not is_valid_timezone(v):
            raise ValueError("Неизвестный часовой пояс")
        return v or None

    @model_validator(mode="after")
    def check_consistency(self):
        if self.rrule:
            # UNTIL из правила дублируем в until_date - по нему фильтруются выборки календаря
            rule_until = parse_rrule(self.rrule).until
            if rule_until and (self.until_date is None or rule_until < self.until_date):
                self.until_date = rule_until
        if self.until_date and self.until_date < self.start_date:
            raise ValueError("Дата окончания раньше даты начала")
        if bool(self.ref_type) != bool(self.ref_uuid):
            raise ValueError("ref_type и ref_uuid задаются вместе")
        if self.payload is not None and json_size(self.payload) > 4000:
            raise ValueError("payload слишком большой")
        return self


class EventOccurrenceData(EntityData):
    event_uuid: UUIDStr
    occurrence_date: JDate
    status: Literal["planned", "done", "skipped", "cancelled"] = "planned"
    moved_date: OptJDate = None
    moved_time: time | None = None
    done_at: datetime | None = None
    note: str | None = Field(default=None, max_length=500)


class ReminderData(EntityData):
    target_type: Literal["event", "tracker"]
    target_uuid: UUIDStr
    offset_min: int = Field(default=0, ge=0, le=10080)
    time_of_day: time | None = None
    rrule: str | None = Field(default=None, max_length=255)
    enabled: bool = True

    @field_validator("rrule")
    @classmethod
    def validate_rrule(cls, v: str | None) -> str | None:
        return _normalize_rrule(v)

    @model_validator(mode="after")
    def check_consistency(self):
        if self.target_type != "event" and self.time_of_day is None:
            raise ValueError("Для напоминания трекера нужно время (time_of_day)")
        return self


class DiaryEntryData(EntityData):
    entry_date: JDate
    entry_time: time | None = None
    title: OptStr = Field(default=None, max_length=200)
    body: str = Field(default="", max_length=20000)
    body_format: Literal["plain", "markdown"] = "plain"
    mood: int | None = Field(default=None, ge=1, le=5)
    tags: list[str] | None = Field(default=None, max_length=20)

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        result: list[str] = []
        for tag in v:
            tag = (tag or "").strip().lstrip("#").strip()
            if not tag:
                continue
            if len(tag) > 50:
                raise ValueError("Тег длиннее 50 символов")
            if tag.lower() not in {t.lower() for t in result}:
                result.append(tag)
        return result


class TrackerData(EntityData):
    name: str = Field(min_length=1, max_length=100)
    value_type: Literal["number", "bool", "scale", "duration", "text"]
    unit: OptStr = Field(default=None, max_length=20)
    icon: OptStr = Field(default=None, max_length=50)
    color: OptStr = Field(default=None, max_length=20)
    scale_min: JNumber = None
    scale_max: JNumber = None
    frequency: Literal["daily", "weekly", "any"] = "daily"
    goal_value: JNumber = None
    goal_direction: Literal["reach", "not_exceed"] | None = None
    template_key: OptStr = Field(default=None, max_length=30)
    sort_order: int = Field(default=0, ge=-100000, le=100000)
    archived: bool = False

    @model_validator(mode="after")
    def check_consistency(self):
        if self.value_type == "scale":
            if self.scale_min is None or self.scale_max is None or self.scale_min >= self.scale_max:
                raise ValueError("Для шкалы нужны scale_min < scale_max")
        return self


class TrackerValueData(EntityData):
    tracker_uuid: UUIDStr
    value_date: JDate
    value_time: time | None = None
    num_value: JNumber = None
    text_value: OptStr = Field(default=None, max_length=500)
    note: OptStr = Field(default=None, max_length=500)


class AttachmentData(EntityData):
    """Вложения создаются только через POST /api/journal/attachments; через sync - только удаление."""
    owner_type: str
    owner_uuid: UUIDStr
