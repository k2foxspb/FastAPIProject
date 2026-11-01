"""Пороговые уведомления и расходные агрегаты бюджетов."""
from datetime import date

import pytest
from sqlalchemy import select

from app.models.journal import JournalTransaction
from app.models.notifications import Notification
from app.services.journal import budgets, finance
from app.services.journal.seed import seed_uuid
from tests.journal.helpers import change, new_uuid, pull_all, push

pytestmark = pytest.mark.asyncio


async def test_budget_thresholds_idempotence_transfers_and_balances(client, session_maker):
    await pull_all(client)
    user_id = client.users.alice.id
    account_uuid = seed_uuid(user_id, "account:cash")
    category_uuid = seed_uuid(user_id, "finance_category:food")
    budget_uuid, expense_uuid = new_uuid(), new_uuid()
    await push(
        client,
        change("budget", budget_uuid, {"category_uuid": category_uuid, "period_month": "2025-03", "limit_kop": 10000}),
        change("transaction", expense_uuid, {
            "account_uuid": account_uuid, "category_uuid": category_uuid, "transaction_date": "2025-03-01",
            "direction": "expense", "amount_kop": 8000, "description": "Продукты",
        }),
    )
    async with session_maker() as db:
        created = await budgets.check_budgets(db, user_id, ["2025-03"])
        assert len(created) == 1
        assert created[0]["data"]["month"] == "2025-03"
        again = await budgets.check_budgets(db, user_id, ["2025-03"])
        assert again == []

        notifications = (await db.execute(select(Notification).where(Notification.user_id == user_id))).scalars().all()
        assert [item.group_key.rsplit(":", 1)[-1] for item in notifications] == ["80"]

    result = await push(client, change("transaction", new_uuid(), {
        "account_uuid": account_uuid, "category_uuid": category_uuid, "transaction_date": "2025-03-02", "direction": "expense",
        "amount_kop": 3000, "description": "Дополнительная покупка",
    }))
    assert result["results"][0]["status"] == "applied"
    async with session_maker() as db:
        created = await budgets.check_budgets(db, user_id, ["2025-03"])
        assert len(created) == 1 and created[0]["data"]["type"] == "journal_budget"
        assert await budgets.check_budgets(db, user_id, ["2025-03"]) == []
        groups = (await db.execute(select(Notification.group_key).where(Notification.user_id == user_id))).scalars().all()
        assert set(key.rsplit(":", 1)[-1] for key in groups) == {"80", "100"}

    # Переводы меняют балансы счетов, но не включаются в расходы и бюджеты.
    second_account = new_uuid()
    await push(client, change("account", second_account, {"name": "Карта", "kind": "card", "currency": "RUB"}))
    await push(client, change("transaction", new_uuid(), {
        "account_uuid": account_uuid, "to_account_uuid": second_account, "transaction_date": "2025-03-03",
        "direction": "transfer", "amount_kop": 5000, "description": "Перевод",
    }))
    calendar = (await client.get("/api/journal/calendar", params={"month": "2025-03"})).json()
    day_totals = {item["date"]: item["expense_kop"] for item in calendar["days"]}
    assert day_totals["2025-03-01"] == 8000 and day_totals["2025-03-02"] == 3000
    assert day_totals["2025-03-03"] == 0
    balances = (await client.get("/api/journal/finance/balances")).json()["accounts"]
    balance_by_uuid = {item["account_uuid"]: item["balance_kop"] for item in balances}
    assert balance_by_uuid[account_uuid] == -16000 and balance_by_uuid[second_account] == 5000
    async with session_maker() as db:
        expenses = await finance.expense_by_day(db, user_id, date(2025, 3, 1), date(2025, 3, 31))
        assert sum(values["expense_kop"] for values in expenses.values()) == 11000
        status = await finance.budget_status(db, user_id, "2025-03")
        assert status[0]["spent_kop"] == 11000
        assert await db.scalar(select(JournalTransaction.id).where(
            JournalTransaction.direction == "transfer", JournalTransaction.user_id == user_id,
        )) is not None


async def test_finance_sync_rejects_invalid_amount_and_category_type(client):
    await pull_all(client)
    user_id = client.users.alice.id
    account_uuid = seed_uuid(user_id, "account:cash")
    income_category = seed_uuid(user_id, "finance_category:salary")
    result = await push(client, change("transaction", new_uuid(), {
        "account_uuid": account_uuid, "category_uuid": income_category, "transaction_date": "2025-03-01",
        "direction": "expense", "amount_kop": 0, "description": "Invalid",
    }))
    assert result["results"][0]["status"] == "rejected"
    assert result["results"][0]["reason"].startswith("invalid:")


async def test_budget_hook_failure_does_not_rollback_sync(client, monkeypatch):
    from app.core.celery_app import celery_app

    await pull_all(client)
    user_id = client.users.alice.id
    account_uuid = seed_uuid(user_id, "account:cash")

    def unavailable_broker(*args, **kwargs):
        raise RuntimeError("broker unavailable")

    monkeypatch.setattr(celery_app, "send_task", unavailable_broker)
    response = await client.post("/api/journal/sync/push", json={"changes": [change("transaction", new_uuid(), {
        "account_uuid": account_uuid, "transaction_date": "2025-03-01", "direction": "expense",
        "amount_kop": 125, "description": "Тест",
    })]})
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "applied"