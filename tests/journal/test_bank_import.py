"""Парсинг выписок, атомарный импорт, дедупликация, откат и доступ к партиям."""
from io import BytesIO
from pathlib import Path

import pytest

from app.services.journal.bank_import.amounts import parse_amount
from app.services.journal.bank_import.dates import parse_date
from app.services.journal.bank_import.decoding import decode_text
from app.services.journal.bank_import.header import find_header, suggested_mapping
from app.services.journal.bank_import.service import _parse_content
from app.services.journal.bank_import.schemes import normalize_row
from app.services.journal.bank_import.sniff import parse_delimited, sniff_delimiter
from app.services.journal.seed import seed_uuid
from tests.journal.helpers import change, new_uuid, pull_all, push

pytestmark = pytest.mark.asyncio


def test_decoding_delimiters_headers_and_multiline_rows():
    assert "Операция" in decode_text("Дата;Операция".encode("utf-8-sig"))
    assert "Операция" in decode_text("Дата;Операция".encode("cp1251"))
    assert "Операция" in decode_text("Дата;Операция".encode("cp866"))
    for delimiter in (";", ",", "\t", "|"):
        content = f"Дата{delimiter}Описание{delimiter}Сумма\n01.03.2025{delimiter}\"Оплата\nмагазин\"{delimiter}12,50"
        assert sniff_delimiter(content) == delimiter
        rows = parse_delimited(content, delimiter)
        header_index, headers = find_header(rows)
        assert header_index == 0 and headers == ["Дата", "Описание", "Сумма"]
        assert rows[1][1] == "Оплата\nмагазин"
        assert suggested_mapping(headers)["amount"] == 2

    fixtures = Path(__file__).resolve().parents[1] / "fixtures" / "statements"
    for filename, delimiter in (("semicolon.csv", ";"), ("comma.csv", ","), ("tab.tsv", "\t"), ("pipe.csv", "|")):
        raw = (fixtures / filename).read_text(encoding="utf-8")
        assert sniff_delimiter(raw) == delimiter
        encodable = raw.replace("−", "-")
        assert decode_text(encodable.encode("cp1251")) == encodable
        assert decode_text(encodable.encode("cp866")) == encodable


def test_dates_and_money_formats_are_exact():
    assert parse_date("2025-03-01")[0].isoformat() == "2025-03-01"
    parsed, ambiguous = parse_date("03/04/2025")
    assert parsed.isoformat() == "2025-04-03" and ambiguous
    assert parse_amount("1\u00a0234,56 ₽") == 123456
    assert parse_amount("1 234,56-") == -123456
    assert parse_amount("(99,01)") == -9901
    assert parse_amount("1.234,56 RUB") == 123456


def test_signed_debit_credit_type_and_currency_schemes():
    signed = normalize_row(["2025-03-01", "Кофе", "−12,50", "RUB"],
                           {"date": 0, "description": 1, "amount": 2, "currency": 3})
    assert (signed["direction"], signed["amount_kop"]) == ("expense", 1250)
    credit = normalize_row(["01.03.2025", "Зачисление", "", "150,00", "RUB"],
                           {"date": 0, "description": 1, "debit": 2, "credit": 3, "currency": 4})
    assert (credit["direction"], credit["amount_kop"]) == ("income", 15000)
    typed = normalize_row(["01.03.2025", "Перевод", "500", "RUB", "Перевод"],
                          {"date": 0, "description": 1, "amount": 2, "currency": 3, "type": 4})
    assert typed["direction"] == "transfer"
    with pytest.raises(ValueError, match="только RUB"):
        normalize_row(["2025-03-01", "Кофе", "12", "USD"],
                      {"date": 0, "description": 1, "amount": 2, "currency": 3})


def test_xlsx_read_only_parser():
    openpyxl = pytest.importorskip("openpyxl")
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append(["Выписка банка"])
    sheet.append(["Дата операции", "Описание", "Сумма"])
    sheet.append(["01.03.2025", "Магазин", "100,00"])
    stream = BytesIO()
    workbook.save(stream)
    kind, delimiter, headers, rows = _parse_content("statement.xlsx", stream.getvalue())
    assert kind == "xlsx" and delimiter is None
    assert headers == ["Дата операции", "Описание", "Сумма"] and rows[0][1] == "Магазин"


async def test_preview_commit_dedup_revert_and_batch_owner_access(client, as_user):
    await pull_all(client)
    account_uuid = seed_uuid(client.users.alice.id, "account:cash")
    csv_bytes = "Дата;Описание;Сумма\n01.03.2025;Кофе;−123,45\n02.03.2025;Покупки;55,00\n".encode("utf-8-sig")
    preview = await client.post("/api/journal/import/preview", files={"file": ("statement.csv", csv_bytes, "text/csv")})
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["row_count"] == 2 and len(body["rows"]) == 2
    mapping = {key: value for key, value in body["suggested_mapping"].items() if value is not None}

    first = await client.post("/api/journal/import/commit", json={
        "preview_token": body["preview_token"], "account_uuid": account_uuid, "mapping": mapping,
    })
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["imported_count"] == 2 and first_body["duplicate_count"] == 0

    duplicate_preview = await client.post(
        "/api/journal/import/preview", files={"file": ("statement.csv", csv_bytes, "text/csv")}
    )
    duplicate_body = duplicate_preview.json()
    as_user(client.users.bob)
    foreign_preview_commit = await client.post("/api/journal/import/commit", json={
        "preview_token": duplicate_body["preview_token"], "account_uuid": account_uuid,
        "mapping": {key: value for key, value in duplicate_body["suggested_mapping"].items() if value is not None},
    })
    assert foreign_preview_commit.status_code == 404
    as_user(client.users.alice)
    duplicate = await client.post("/api/journal/import/commit", json={
        "preview_token": duplicate_body["preview_token"], "account_uuid": account_uuid,
        "mapping": {key: value for key, value in duplicate_body["suggested_mapping"].items() if value is not None},
    })
    assert duplicate.status_code == 200 and duplicate.json()["duplicate_count"] == 2

    batch_uuid = first_body["batch_uuid"]
    details = await client.get(f"/api/journal/import/batches/{batch_uuid}")
    assert details.status_code == 200 and len(details.json()["transactions"]) == 2
    as_user(client.users.bob)
    assert (await client.get(f"/api/journal/import/batches/{batch_uuid}")).status_code == 404
    assert (await client.post(f"/api/journal/import/batches/{batch_uuid}/revert")).status_code == 404
    assert (await client.post("/api/journal/import/commit", json={
        "preview_token": body["preview_token"], "account_uuid": account_uuid, "mapping": mapping,
    })).status_code == 404

    as_user(client.users.alice)
    reverted = await client.post(f"/api/journal/import/batches/{batch_uuid}/revert")
    assert reverted.status_code == 200 and reverted.json()["status"] == "reverted"
    details = await client.get(f"/api/journal/import/batches/{batch_uuid}")
    assert details.json()["status"] == "reverted"
    assert all(item["deleted_at"] is not None for item in details.json()["transactions"])


async def test_import_limits_and_invalid_file(client, monkeypatch):
    from app.core import config

    assert (await client.post("/api/journal/import/preview", files={
        "file": ("statement.bin", b"not a statement", "application/octet-stream")
    })).status_code == 422
    monkeypatch.setattr(config, "JOURNAL_IMPORT_MAX_BYTES", 16)
    response = await client.post("/api/journal/import/preview", files={
        "file": ("statement.csv", "Дата;Сумма\n2025-01-01;100".encode("utf-8"), "text/csv")
    })
    assert response.status_code == 413


async def test_sync_transaction_refs_are_owner_scoped(client, as_user):
    await pull_all(client)
    account_uuid = seed_uuid(client.users.alice.id, "account:cash")
    as_user(client.users.bob)
    result = await push(client, change("transaction", new_uuid(), {
        "account_uuid": account_uuid, "transaction_date": "2025-03-01", "direction": "expense",
        "amount_kop": 100, "description": "Кофе",
    }))
    assert result["results"][0]["status"] == "rejected"
    assert result["results"][0]["reason"] == "missing_ref:account_uuid"