"""Проверки сопоставления колонок и преобразование raw rows."""
from app.services.journal.bank_import.schemes import normalize_row

ALLOWED_FIELDS = {"date", "description", "amount", "debit", "credit", "type", "currency", "merchant", "external_id"}


def validate_mapping(mapping: dict, headers: list[str]) -> dict[str, int | None]:
    if not mapping or set(mapping) - ALLOWED_FIELDS:
        raise ValueError("Некорректное сопоставление колонок")
    result = {}
    for field, index in mapping.items():
        if isinstance(index, bool) or not isinstance(index, int) or index < 0 or index >= len(headers):
            raise ValueError("Колонка сопоставлена некорректно")
        result[field] = index
    if "date" not in result or not ({"amount", "debit", "credit"} & set(result)):
        raise ValueError("Нужно сопоставить дату и сумму либо дебет/кредит")
    return result


def normalize_rows(rows: list[list], mapping: dict, date_format: str | None = None) -> list[dict]:
    result = []
    errors = []
    for line, row in enumerate(rows, 1):
        if not any(str(value or "").strip() for value in row):
            continue
        try:
            item = normalize_row(row, mapping, date_format)
            item["source_line"] = line
            result.append(item)
        except ValueError:
            errors.append(line)
    if errors:
        raise ValueError(f"Не удалось разобрать строки: {', '.join(map(str, errors[:20]))}")
    return result