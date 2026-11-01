"""Определение формата и разделителя выписки."""
import csv
import io
from pathlib import PurePath


def file_format(filename: str, content: bytes) -> str:
    suffix = PurePath(filename).suffix.lower()
    if suffix in (".xlsx", ".xlsm") or content.startswith(b"PK\x03\x04"):
        return "xlsx"
    if suffix in (".csv", ".tsv", ".txt", ""):
        return "tsv" if suffix == ".tsv" else "csv"
    raise ValueError("Поддерживаются только CSV, TSV и XLSX")


def sniff_delimiter(text: str) -> str:
    sample = "\n".join(text.splitlines()[:30])
    try:
        return csv.Sniffer().sniff(sample, delimiters=";,\t|").delimiter
    except csv.Error:
        counts = {delimiter: sample.count(delimiter) for delimiter in (";", ",", "\t", "|")}
        return max(counts, key=counts.get) if max(counts.values(), default=0) else ";"


def parse_delimited(text: str, delimiter: str) -> list[list[str]]:
    return [list(row) for row in csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)]