"""
Повторения событий и напоминаний журнала.

Формат правила - подмножество RFC 5545 RRULE (то же понимает npm-пакет `rrule`
на клиенте):
    FREQ=DAILY|WEEKLY|MONTHLY; INTERVAL=N; BYDAY=MO,WE (только для WEEKLY);
    BYMONTHDAY=1..31 или -1..-31 (только для MONTHLY); UNTIL=YYYYMMDD
Правило разворачивается в «плавающем» локальном времени (даты без таймзоны),
перевод конкретного срабатывания в UTC - через IANA-таймзону (local_to_utc).

Конкретные даты не хранятся: исключения/выполнения/переносы лежат в
journal_event_occurrences и накладываются функцией expand_event().
"""
import datetime as dt
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from typing import Any, Mapping
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil import rrule as du

FREQS = {"DAILY": du.DAILY, "WEEKLY": du.WEEKLY, "MONTHLY": du.MONTHLY}
WEEKDAYS = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")
MAX_INTERVAL = 366
# Защита от разворачивания огромных диапазонов (например, ежедневное правило на 100 лет).
MAX_INSTANCES = 2000


@dataclass(frozen=True)
class RecurrenceRule:
    freq: str
    interval: int = 1
    byday: tuple[int, ...] = ()
    bymonthday: tuple[int, ...] = ()
    until: date | None = None


def parse_rrule(value: str) -> RecurrenceRule:
    """Разбирает и валидирует правило. Бросает ValueError с понятным текстом."""
    if not value or not isinstance(value, str):
        raise ValueError("Пустое правило повторения")
    text = value.strip()
    if text.upper().startswith("RRULE:"):
        text = text[6:]
    parts: dict[str, str] = {}
    for chunk in text.split(";"):
        if not chunk.strip():
            continue
        if "=" not in chunk:
            raise ValueError(f"Некорректная часть правила: {chunk!r}")
        key, _, val = chunk.partition("=")
        key = key.strip().upper()
        if key in parts:
            raise ValueError(f"Повторяющийся параметр {key}")
        parts[key] = val.strip().upper()

    unknown = set(parts) - {"FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "UNTIL"}
    if unknown:
        raise ValueError(f"Неподдерживаемые параметры: {', '.join(sorted(unknown))}")

    freq = parts.get("FREQ")
    if freq not in FREQS:
        raise ValueError("FREQ должен быть DAILY, WEEKLY или MONTHLY")

    interval = 1
    if "INTERVAL" in parts:
        try:
            interval = int(parts["INTERVAL"])
        except ValueError:
            raise ValueError("INTERVAL должен быть числом")
        if not 1 <= interval <= MAX_INTERVAL:
            raise ValueError(f"INTERVAL должен быть от 1 до {MAX_INTERVAL}")

    byday: tuple[int, ...] = ()
    if "BYDAY" in parts:
        if freq != "WEEKLY":
            raise ValueError("BYDAY поддерживается только для FREQ=WEEKLY")
        days = [d.strip() for d in parts["BYDAY"].split(",") if d.strip()]
        if not days or any(d not in WEEKDAYS for d in days):
            raise ValueError("BYDAY: допустимы MO,TU,WE,TH,FR,SA,SU")
        byday = tuple(sorted({WEEKDAYS.index(d) for d in days}))

    bymonthday: tuple[int, ...] = ()
    if "BYMONTHDAY" in parts:
        if freq != "MONTHLY":
            raise ValueError("BYMONTHDAY поддерживается только для FREQ=MONTHLY")
        try:
            mdays = [int(x) for x in parts["BYMONTHDAY"].split(",") if x.strip()]
        except ValueError:
            raise ValueError("BYMONTHDAY должен быть списком чисел")
        if not mdays or any(not (1 <= abs(x) <= 31) for x in mdays):
            raise ValueError("BYMONTHDAY: допустимы 1..31 и -1..-31")
        bymonthday = tuple(sorted(set(mdays)))

    until = None
    if "UNTIL" in parts:
        raw = parts["UNTIL"]
        try:
            until = datetime.strptime(raw[:8], "%Y%m%d").date()
        except ValueError:
            raise ValueError("UNTIL должен быть в формате YYYYMMDD")

    return RecurrenceRule(freq=freq, interval=interval, byday=byday, bymonthday=bymonthday, until=until)


def format_rrule(rule: RecurrenceRule) -> str:
    """Каноническая строка правила."""
    parts = [f"FREQ={rule.freq}"]
    if rule.interval != 1:
        parts.append(f"INTERVAL={rule.interval}")
    if rule.byday:
        parts.append("BYDAY=" + ",".join(WEEKDAYS[d] for d in rule.byday))
    if rule.bymonthday:
        parts.append("BYMONTHDAY=" + ",".join(str(d) for d in rule.bymonthday))
    if rule.until:
        parts.append(f"UNTIL={rule.until:%Y%m%d}")
    return ";".join(parts)


def _as_rule(rule: RecurrenceRule | str) -> RecurrenceRule:
    return parse_rrule(rule) if isinstance(rule, str) else rule


def iter_dates(
    rule: RecurrenceRule | str,
    dtstart: date,
    start: date,
    end: date,
    until: date | None = None,
) -> list[date]:
    """Даты срабатываний правила в диапазоне [start, end] включительно."""
    rule = _as_rule(rule)
    limits = [d for d in (rule.until, until) if d is not None]
    effective_until = min(limits) if limits else None
    lo = max(start, dtstart)
    hi = end if effective_until is None else min(end, effective_until)
    if hi < lo:
        return []

    kwargs: dict[str, Any] = {
        "dtstart": datetime.combine(dtstart, time()),
        "interval": rule.interval,
        "until": datetime.combine(hi, time()),
        "wkst": du.MO,
    }
    if rule.byday:
        kwargs["byweekday"] = rule.byday
    if rule.bymonthday:
        kwargs["bymonthday"] = rule.bymonthday
    generator = du.rrule(FREQS[rule.freq], **kwargs)

    result: list[date] = []
    for dt in generator.xafter(datetime.combine(lo, time()), inc=True):
        if dt.date() > hi:
            break
        result.append(dt.date())
        if len(result) >= MAX_INSTANCES:
            break
    return result


def is_occurrence(rule: RecurrenceRule | str, dtstart: date, day: date, until: date | None = None) -> bool:
    return bool(iter_dates(rule, dtstart, day, day, until))


def get_zone(tz_name: str | None, default: str = "UTC") -> ZoneInfo:
    try:
        return ZoneInfo(tz_name or default)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(default)


def is_valid_timezone(tz_name: str) -> bool:
    try:
        ZoneInfo(tz_name)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


def local_to_utc(day: date, at: time, tz_name: str) -> datetime:
    """
    «Настенное» время в таймзоне -> UTC. Для несуществующего времени (переход
    на летнее время) используется смещение до перехода, т.е. время сдвигается
    вперёд (02:30 -> 03:30); для неоднозначного (переход на зимнее) берётся
    первое из двух.
    """
    local = datetime.combine(day, at.replace(tzinfo=None)).replace(tzinfo=get_zone(tz_name), fold=0)
    return local.astimezone(timezone.utc)


@dataclass
class EventInstance:
    event_uuid: str
    original_date: dt.date
    date: dt.date
    time: dt.time | None
    status: str
    title: str
    kind: str
    occurrence_uuid: str | None = None
    recurring: bool = False


def expand_event(event: Any, overrides: Mapping[date, Any], start: date, end: date) -> list[EventInstance]:
    """
    Разворачивает событие в экземпляры в диапазоне [start, end] с учётом
    исключений (overrides: исходная дата -> запись occurrence, без удалённых).

    Ожидаемые атрибуты event: client_uuid, rrule, start_date, start_time,
    until_date, status, title, kind. Атрибуты override: occurrence_date,
    status, moved_date, moved_time, client_uuid.
    """
    recurring = bool(event.rrule)
    if recurring:
        rule = parse_rrule(event.rrule)
        candidates = set(iter_dates(rule, event.start_date, start, end, event.until_date))
        # Экземпляры, перенесённые в диапазон с дат за его пределами
        for orig, occ in overrides.items():
            if orig in candidates or not occ.moved_date:
                continue
            if start <= occ.moved_date <= end and is_occurrence(rule, event.start_date, orig, event.until_date):
                candidates.add(orig)
    else:
        candidates = {event.start_date}

    instances: list[EventInstance] = []
    for orig in sorted(candidates):
        occ = overrides.get(orig)
        status = occ.status if occ is not None else (event.status if not recurring else "planned")
        if status == "cancelled":
            continue
        day = (occ.moved_date if occ is not None and occ.moved_date else orig)
        if not start <= day <= end:
            continue
        at = (occ.moved_time if occ is not None and occ.moved_time else event.start_time)
        instances.append(EventInstance(
            event_uuid=event.client_uuid,
            original_date=orig,
            date=day,
            time=at,
            status=status,
            title=event.title,
            kind=event.kind,
            occurrence_uuid=occ.client_uuid if occ is not None else None,
            recurring=recurring,
        ))
    instances.sort(key=lambda i: (i.date, i.time or time.min))
    return instances
