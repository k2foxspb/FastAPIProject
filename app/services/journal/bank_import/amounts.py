"""Разбор денежных значений в целые копейки без float."""
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


def parse_amount(value: object) -> int:
    if value is None or value == "":
        raise ValueError("Не указана сумма")
    if isinstance(value, (int, Decimal)):
        amount = Decimal(value)
        return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    text = str(value).replace("\u00a0", " ").replace("\u202f", " ").strip()
    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative, text = True, text[1:-1]
    text = re.sub(r"(?i)\b(?:руб(?:лей|ля)?|rub)\b|₽|\s", "", text)
    if text.endswith(("-", "−")):
        negative, text = True, text[:-1]
    if text.startswith(("-", "−")):
        negative, text = True, text[1:]
    text = text.replace("+", "")
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(",", ".")
    else:
        # Точка с тремя цифрами справа чаще разделитель тысяч, иначе десятичная часть.
        if re.fullmatch(r"\d{1,3}(?:\.\d{3})+", text):
            text = text.replace(".", "")
    try:
        amount = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError("Некорректная сумма") from exc
    if not amount.is_finite():
        raise ValueError("Некорректная сумма")
    return int(((-amount if negative else amount) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))