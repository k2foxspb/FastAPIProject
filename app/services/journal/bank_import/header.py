"""Поиск строки заголовков и стабильный fingerprint набора колонок."""
import hashlib
import re
import unicodedata

ALIASES = {
    "date": ("date", "дата", "дата операции", "дата проведения", "дата транзакции"),
    "description": ("description", "назначение", "описание", "операция", "детали операции", "комментарий"),
    "amount": ("amount", "сумма", "сумма операции", "сумма в рублях"),
    "debit": ("debit", "расход", "списание", "дебет"),
    "credit": ("credit", "доход", "зачисление", "кредит"),
    "type": ("type", "тип", "тип операции", "направление"),
    "currency": ("currency", "валюта", "код валюты"),
    "merchant": ("merchant", "получатель", "магазин", "контрагент"),
    "external_id": ("id", "идентификатор", "номер операции", "operation id"),
}


def normalize_header(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower().replace("ё", "е")
    return re.sub(r"[^\w]+", " ", text, flags=re.UNICODE).strip()


def suggested_mapping(headers: list[str]) -> dict[str, int | None]:
    normalized = [normalize_header(header) for header in headers]
    result = {}
    for field, aliases in ALIASES.items():
        candidates = [normalize_header(alias) for alias in aliases]
        result[field] = next((i for i, value in enumerate(normalized) if value in candidates), None)
    return result


def find_header(rows: list[list[object]]) -> tuple[int, list[str]]:
    best_index, best_headers, best_score = -1, [], 0
    for index, row in enumerate(rows[:15]):
        headers = [str(value or "").strip() for value in row]
        mapping = suggested_mapping(headers)
        score = sum(mapping[field] is not None for field in ("date", "amount", "debit", "credit", "description"))
        if score > best_score:
            best_index, best_headers, best_score = index, headers, score
    if best_index < 0 or best_score < 2:
        raise ValueError("Не найдена строка заголовков выписки")
    return best_index, best_headers


def fingerprint(headers: list[str]) -> str:
    value = "\x1f".join(normalize_header(header) for header in headers)
    return hashlib.sha256(value.encode("utf-8")).hexdigest()