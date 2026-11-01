"""Вспомогательные функции тестов журнала."""
import uuid
from datetime import datetime, timedelta, timezone

BASE_TS = datetime(2025, 3, 1, 12, 0, tzinfo=timezone.utc)


def new_uuid() -> str:
    return str(uuid.uuid4())


def ts(offset_sec: int = 0) -> str:
    return (BASE_TS + timedelta(seconds=offset_sec)).isoformat()


def change(entity: str, client_uuid: str, data: dict | None = None, op: str = "upsert", at: str | None = None) -> dict:
    return {"entity": entity, "client_uuid": client_uuid, "op": op, "updated_at": at or ts(), "data": data}


async def push(client, *changes: dict) -> dict:
    response = await client.post("/api/journal/sync/push", json={"device_id": "test", "changes": list(changes)})
    assert response.status_code == 200, response.text
    return response.json()


async def pull_all(client, since: int = 0, limit: int = 1000) -> tuple[list[dict], int]:
    changes: list[dict] = []
    while True:
        response = await client.get("/api/journal/sync/pull", params={"since": since, "limit": limit})
        assert response.status_code == 200, response.text
        body = response.json()
        changes.extend(body["changes"])
        since = body["cursor"]
        if not body["has_more"]:
            return changes, since


def diary(entry_date: str = "2025-03-01", body: str = "Текст", **extra) -> dict:
    return {"entry_date": entry_date, "body": body, **extra}


def tracker(name: str = "Вес", value_type: str = "number", **extra) -> dict:
    return {"name": name, "value_type": value_type, **extra}
