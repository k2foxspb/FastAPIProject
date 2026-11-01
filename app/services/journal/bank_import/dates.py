"""Разбор дат выписок с явной пометкой неоднозначных числовых дат."""
from datetime import date, datetime


def parse_date(value: object, date_format: str | None = None) -> tuple[date, bool]:
    if isinstance(value, datetime):
        return value.date(), False
    if isinstance(value, date):
        return value, False
    text = str(value or "").strip()
    try:
        return datetime.fromisoformat(text).date(), False
    except ValueError:
        pass
    formats = [date_format] if date_format else []
    formats += ["%d.%m.%Y", "%d.%m.%y", "%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y"]
    for fmt in formats:
        if not fmt:
            continue
        try:
            parsed = datetime.strptime(text, fmt).date()
            ambiguous = "/" in text and fmt in ("%d/%m/%Y", "%m/%d/%Y") and parsed.day <= 12
            return parsed, ambiguous
        except ValueError:
            pass
    raise ValueError("Некорректная дата")