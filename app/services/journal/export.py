"""Экспорт данных журнала в CSV. Значения, которые Excel/LibreOffice может принять за формулу, экранируются."""
import csv
import io
from decimal import Decimal

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def escape_cell(value) -> str:
    """Защита от CSV-инъекций: строка, начинающаяся с символа формулы, получает апостроф-префикс."""
    if value is None:
        return ""
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if text.startswith(FORMULA_PREFIXES):
        return "'" + text
    return text


def rows_to_csv(header: list[str], rows: list[list]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    writer.writerow([escape_cell(column) for column in header])
    for row in rows:
        writer.writerow([escape_cell(cell) for cell in row])
    return "\ufeff" + buffer.getvalue()
