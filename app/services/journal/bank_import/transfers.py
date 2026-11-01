"""Поиск возможных пар переводов; пары только предлагаются пользователю."""
from datetime import timedelta


def find_transfer_candidates(items: list[dict], existing: list[dict]) -> list[dict]:
    candidates = []
    all_items = list(items) + list(existing)
    for index, first in enumerate(all_items):
        for second in all_items[index + 1:]:
            if first.get("account_id") == second.get("account_id"):
                continue
            if first.get("direction") == second.get("direction") or first.get("direction") == "transfer" or second.get("direction") == "transfer":
                continue
            if first.get("amount_kop") != second.get("amount_kop"):
                continue
            if abs((first["transaction_date"] - second["transaction_date"]).days) > 2:
                continue
            candidates.append({"first_uuid": first.get("client_uuid"), "second_uuid": second.get("client_uuid")})
    return candidates