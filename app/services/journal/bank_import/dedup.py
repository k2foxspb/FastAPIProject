"""Детерминированное обнаружение повторных банковских операций."""
import hashlib
import re


def transaction_fingerprint(item: dict, account_uuid: str) -> str:
    description = re.sub(r"\s+", " ", str(item.get("description") or "").strip().lower())
    merchant = re.sub(r"\s+", " ", str(item.get("merchant") or "").strip().lower())
    external_id = str(item.get("external_id") or "").strip().lower()
    raw = "|".join((account_uuid, external_id, str(item["transaction_date"]), item["direction"],
                    str(item["amount_kop"]), merchant, description))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()