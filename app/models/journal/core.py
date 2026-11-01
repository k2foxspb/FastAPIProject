"""
Ядро модуля «Журнал жизни» (фаза 1): настройки, события и повторения,
напоминания, дневник, пользовательские трекеры, вложения.
"""
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import (
    JSON, BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer,
    Numeric, SmallInteger, String, Text, Time, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.journal.base import BigIntPK, JournalEntityMixin, entity_table_args


class JournalSettings(JournalEntityMixin, Base):
    """Настройки журнала пользователя (одна строка на пользователя)."""
    __tablename__ = "journal_settings"
    __table_args__ = entity_table_args(
        "journal_settings",
        UniqueConstraint("user_id", name="uq_journal_settings_user"),
    )

    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Moscow", nullable=False)
    # 1 = понедельник ... 7 = воскресенье (ISO)
    week_start: Mapped[int] = mapped_column(SmallInteger, default=1, nullable=False)
    kcal_goal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    protein_g_goal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fat_g_goal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    carbs_g_goal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    water_ml_goal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height_cm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)
    seed_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class JournalSyncState(Base):
    """Служебная таблица: последний выданный server_rev пользователя."""
    __tablename__ = "journal_sync_state"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    last_rev: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    # Tombstones с ревизией <= purged_rev физически удалены: pull с since < purged_rev -> 410.
    purged_rev: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)


class JournalEvent(JournalEntityMixin, Base):
    """
    Событие / запланированная запись. Повторяющееся событие хранит правило
    (подмножество RFC 5545 RRULE), конкретные даты не размножаются.
    """
    __tablename__ = "journal_events"
    __table_args__ = entity_table_args(
        "journal_events",
        Index("ix_journal_events_user_start", "user_id", "start_date"),
    )

    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # meal | payment | note | tracker | custom
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)  # None = весь день
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rrule: Mapped[str | None] = mapped_column(String(255), nullable=True)
    until_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="planned", nullable=False)  # для разовых событий
    # Полиморфная ссылка на сущность журнала (трекер, тип приёма пищи, счёт) по client_uuid.
    ref_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ref_uuid: Mapped[str | None] = mapped_column(String(36), nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)


class JournalEventOccurrence(JournalEntityMixin, Base):
    """Исключение/выполнение повторяющегося (или разового) события на конкретную дату."""
    __tablename__ = "journal_event_occurrences"
    __table_args__ = entity_table_args(
        "journal_event_occurrences",
        UniqueConstraint("event_id", "occurrence_date", name="uq_journal_event_occurrences_event_date"),
        Index("ix_journal_event_occurrences_user_date", "user_id", "occurrence_date"),
    )

    event_id: Mapped[int] = mapped_column(
        BigIntPK, ForeignKey("journal_events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    occurrence_date: Mapped[date] = mapped_column(Date, nullable=False)  # исходная дата по правилу
    status: Mapped[str] = mapped_column(String(20), default="planned", nullable=False)  # planned|done|skipped|cancelled
    moved_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    moved_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)


class JournalReminder(JournalEntityMixin, Base):
    """
    Напоминание (срабатывает локально на устройстве через Notifee).
    Привязано к событию (offset_min до начала) либо к трекеру/типу приёма пищи
    (time_of_day + собственное правило повторения).
    """
    __tablename__ = "journal_reminders"
    __table_args__ = entity_table_args(
        "journal_reminders",
        Index("ix_journal_reminders_user_target", "user_id", "target_uuid"),
    )

    target_type: Mapped[str] = mapped_column(String(20), nullable=False)  # event | tracker | meal_type
    target_uuid: Mapped[str] = mapped_column(String(36), nullable=False)
    offset_min: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    time_of_day: Mapped[time | None] = mapped_column(Time, nullable=True)
    rrule: Mapped[str | None] = mapped_column(String(255), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class JournalDiaryEntry(JournalEntityMixin, Base):
    __tablename__ = "journal_diary_entries"
    __table_args__ = entity_table_args(
        "journal_diary_entries",
        Index("ix_journal_diary_entries_user_date", "user_id", "entry_date"),
        CheckConstraint("mood IS NULL OR (mood >= 1 AND mood <= 5)", name="mood_range"),
    )

    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    entry_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    body_format: Mapped[str] = mapped_column(String(10), default="plain", nullable=False)  # plain | markdown
    mood: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)


class JournalTracker(JournalEntityMixin, Base):
    """Определение пользовательского трекера (вес, сон, привычка и т.п.)."""
    __tablename__ = "journal_trackers"
    __table_args__ = entity_table_args("journal_trackers")

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    value_type: Mapped[str] = mapped_column(String(10), nullable=False)  # number|bool|scale|duration|text
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    scale_min: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    scale_max: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    frequency: Mapped[str] = mapped_column(String(10), default="daily", nullable=False)  # daily|weekly|any
    goal_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    goal_direction: Mapped[str | None] = mapped_column(String(20), nullable=True)  # reach | not_exceed
    template_key: Mapped[str | None] = mapped_column(String(30), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class JournalTrackerValue(JournalEntityMixin, Base):
    __tablename__ = "journal_tracker_values"
    __table_args__ = entity_table_args(
        "journal_tracker_values",
        Index("ix_journal_tracker_values_user_date", "user_id", "value_date"),
        Index("ix_journal_tracker_values_tracker_date", "tracker_id", "value_date"),
    )

    tracker_id: Mapped[int] = mapped_column(
        BigIntPK, ForeignKey("journal_trackers.id", ondelete="CASCADE"), nullable=False
    )
    value_date: Mapped[date] = mapped_column(Date, nullable=False)
    value_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    # Число / да-нет (0|1) / шкала / длительность в минутах
    num_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    text_value: Mapped[str | None] = mapped_column(String(500), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)


class JournalAttachment(JournalEntityMixin, Base):
    """
    Вложение (фото) к записи журнала. Файл лежит в хранилище в категории
    journal/u<id>/... и отдаётся только владельцу через API (не через /media).
    """
    __tablename__ = "journal_attachments"
    __table_args__ = entity_table_args(
        "journal_attachments",
        Index("ix_journal_attachments_user_owner", "user_id", "owner_uuid"),
    )

    owner_type: Mapped[str] = mapped_column(String(30), nullable=False)
    owner_uuid: Mapped[str] = mapped_column(String(36), nullable=False)
    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    mime: Mapped[str | None] = mapped_column(String(50), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
