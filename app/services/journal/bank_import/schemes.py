"""Нормализация строк выписки из основных банковских схем."""
from datetime import date

from app.services.journal.bank_import.amounts import parse_amount
from app.services.journal.bank_import.dates import parse_date


def _cell(row: list, mapping: dict, key: str):
    index = mapping.get(key)
    return row[index] if index is not None and 0 <= index < len(row) else None


def normalize_row(row: list, mapping: dict, date_format: str | None = None) -> dict:
    transaction_date, ambiguous = parse_date(_cell(row, mapping, "date"), date_format)
    description = str(_cell(row, mapping, "description") or "").strip()
    merchant = str(_cell(row, mapping, "merchant") or "").strip() or None
    external_id = str(_cell(row, mapping, "external_id") or "").strip() or None
    currency = str(_cell(row, mapping, "currency") or "RUB").strip().upper()
    if currency not in ("RUB", "RUR", "₽", "РУБ."):
        raise ValueError("Поддерживается только RUB")

    debit, credit = _cell(row, mapping, "debit"), _cell(row, mapping, "credit")
    if debit not in (None, "") or credit not in (None, ""):
        debit_kop = abs(parse_amount(debit)) if debit not in (None, "") else 0
        credit_kop = abs(parse_amount(credit)) if credit not in (None, "") else 0
        if debit_kop and credit_kop:
            raise ValueError("Одновременно указаны дебет и кредит")
        amount_kop, direction = (debit_kop, "expense") if debit_kop else (credit_kop, "income")
    else:
        amount_kop = parse_amount(_cell(row, mapping, "amount"))
        direction = "income" if amount_kop > 0 else "expense"
        amount_kop = abs(amount_kop)
    kind = str(_cell(row, mapping, "type") or "").lower()
    if kind:
        if any(word in kind for word in ("поступ", "зачис", "доход", "credit", "income")):
            direction = "income"
        elif any(word in kind for word in ("спис", "расход", "debit", "expense", "покуп")):
            direction = "expense"
        elif any(word in kind for word in ("перевод", "transfer")):
            direction = "transfer"
    if amount_kop <= 0:
        raise ValueError("Сумма должна быть больше нуля")
    return {
        "transaction_date": transaction_date, "direction": direction, "amount_kop": amount_kop,
        "description": description or merchant or "Операция", "merchant": merchant,
        "external_id": external_id, "ambiguous_date": ambiguous,
    }