"""Диета: sync новых сущностей, расчёт КБЖУ рецептов, итоги дня, календарь, доступ."""
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import update

from app.models.journal import JournalSettings
from app.services.journal.nutrition import Per100, portion, recipe_per100
from app.services.journal.seed import MEAL_TYPES, seed_uuid
from tests.journal.helpers import change, new_uuid, pull_all, push, ts

pytestmark = pytest.mark.asyncio


def food(name="Гречка", kcal=343, p=13.3, f=3.4, c=72.6, **extra) -> dict:
    return {"name": name, "kcal_100": kcal, "protein_100": p, "fat_100": f, "carbs_100": c, **extra}


def entry(entry_date="2025-03-01", name="Гречка", grams=200, kcal=686, **extra) -> dict:
    return {"entry_date": entry_date, "entry_time": "13:05", "name": name, "grams": grams, "kcal": kcal,
            "protein": 26.6, "fat": 6.8, "carbs": 145.2, **extra}


# ---------------------------------------------------------------- чистые расчёты

def test_portion():
    per100 = Per100(Decimal("343"), Decimal("13.3"), Decimal("3.4"), Decimal("72.6"))
    assert portion(per100, 150) == {
        "kcal": Decimal("514.50"), "protein": Decimal("19.95"), "fat": Decimal("5.10"), "carbs": Decimal("108.90"),
    }


def test_recipe_per100_without_and_with_yield():
    rice = Per100(Decimal(130), Decimal("2.7"), Decimal("0.3"), Decimal(28))
    chicken = Per100(Decimal(165), Decimal(31), Decimal("3.6"), Decimal(0))
    ingredients = [(rice, Decimal(200)), (chicken, Decimal(100))]

    per100, weight = recipe_per100(ingredients)
    assert weight == Decimal("300.00")
    # (260 + 165) / 300 * 100 = 141.67
    assert per100.kcal == Decimal("141.67")
    assert per100.protein == Decimal("12.13")  # (5.4 + 31) / 3

    # Ужарка до 250 г: то же количество калорий на меньший вес
    per100, weight = recipe_per100(ingredients, yield_g=250)
    assert weight == Decimal("250.00")
    assert per100.kcal == Decimal("170.00")


def test_recipe_per100_empty():
    per100, weight = recipe_per100([])
    assert weight == 0 and per100.kcal == 0


# ---------------------------------------------------------------- sync

async def test_full_pull_seeds_meal_types(client):
    changes, _ = await pull_all(client)
    meal_types = {c["client_uuid"]: c["data"] for c in changes if c["entity"] == "meal_type"}
    uid = client.users.alice.id
    expected = {seed_uuid(uid, f"meal_type:{m['key']}"): m for m in MEAL_TYPES}
    assert set(meal_types) == set(expected)
    lunch = meal_types[seed_uuid(uid, "meal_type:lunch")]
    assert lunch["name"] == "Обед" and lunch["default_time"] == "13:00:00" and lunch["reminder_enabled"] is False

    # Повторная полная синхронизация не создаёт дублей
    again, _ = await pull_all(client)
    assert sum(1 for c in again if c["entity"] == "meal_type") == len(MEAL_TYPES)


async def test_existing_user_gets_meal_types_on_regular_pull(client, session_maker):
    _, cursor = await pull_all(client)
    deleted_uuid = seed_uuid(client.users.alice.id, "meal_type:snack")
    await push(client, change("meal_type", deleted_uuid, op="delete", at=ts(10)))
    # Имитируем пользователя фазы 1: версия стартовых наборов 1
    async with session_maker() as db:
        await db.execute(update(JournalSettings).values(seed_version=1))
        await db.commit()

    changes, _ = await pull_all(client, since=cursor)
    settings = next(c for c in changes if c["entity"] == "settings")
    assert settings["data"]["seed_version"] == 3
    # Удалённый пользователем стартовый тип не воскрешается
    alive = [c for c in changes if c["entity"] == "meal_type" and c["deleted_at"] is None]
    assert deleted_uuid not in {c["client_uuid"] for c in alive}


async def test_food_entry_with_refs_and_water(client):
    meal_uuid, food_uuid, entry_uuid, water_uuid = new_uuid(), new_uuid(), new_uuid(), new_uuid()
    result = await push(
        client,
        change("food_entry", entry_uuid, entry(meal_type_uuid=meal_uuid, food_uuid=food_uuid)),
        change("meal_type", meal_uuid, {"name": "Второй завтрак", "default_time": "10:30", "reminder_enabled": True}),
        change("food", food_uuid, food(use_count=3)),
        change("water_entry", water_uuid, {"entry_date": "2025-03-01", "entry_time": "09:00", "amount_ml": 250}),
    )
    assert [r["status"] for r in result["results"]] == ["applied"] * 4

    changes, _ = await pull_all(client)
    by_uuid = {c["client_uuid"]: c for c in changes}
    data = by_uuid[entry_uuid]["data"]
    assert data["meal_type_uuid"] == meal_uuid and data["food_uuid"] == food_uuid
    assert data["kcal"] == 686 and data["protein"] == 26.6
    assert "meal_type_id" not in data and "food_id" not in data
    assert by_uuid[water_uuid]["data"]["amount_ml"] == 250


async def test_deleting_food_keeps_entries_and_nulls_ref(client):
    food_uuid, entry_uuid = new_uuid(), new_uuid()
    first = await push(client, change("food", food_uuid, food()),
                       change("food_entry", entry_uuid, entry(food_uuid=food_uuid)))
    await push(client, change("food", food_uuid, op="delete", at=ts(10)))

    changes, _ = await pull_all(client, since=first["cursor"])
    by_uuid = {c["client_uuid"]: c for c in changes}
    assert by_uuid[food_uuid]["deleted_at"] is not None
    kept = by_uuid[entry_uuid]
    assert kept["deleted_at"] is None
    assert kept["data"]["food_uuid"] is None
    assert kept["data"]["name"] == "Гречка" and kept["data"]["kcal"] == 686


async def test_recipe_items_validation_and_cascade(client):
    recipe, rice, other_recipe, item = new_uuid(), new_uuid(), new_uuid(), new_uuid()
    first = await push(
        client,
        change("food", recipe, food("Плов", 0, 0, 0, 0, is_recipe=True, source="recipe")),
        change("food", other_recipe, food("Салат", 0, 0, 0, 0, is_recipe=True, source="recipe")),
        change("food", rice, food("Рис", 130, 2.7, 0.3, 28)),
        change("recipe_item", item, {"recipe_uuid": recipe, "ingredient_uuid": rice, "grams": 200}),
        # Ингредиент-рецепт и «рецепт» без флага is_recipe отклоняются
        change("recipe_item", new_uuid(), {"recipe_uuid": recipe, "ingredient_uuid": other_recipe, "grams": 50}),
        change("recipe_item", new_uuid(), {"recipe_uuid": rice, "ingredient_uuid": recipe, "grams": 50}),
        change("recipe_item", new_uuid(), {"recipe_uuid": recipe, "ingredient_uuid": recipe, "grams": 50}),
    )
    statuses = [r["status"] for r in first["results"]]
    assert statuses[:4] == ["applied"] * 4
    assert statuses[4:] == ["rejected"] * 3

    # Удаление ингредиента удаляет строку рецепта (каскад), рецепт остаётся
    await push(client, change("food", rice, op="delete", at=ts(10)))
    changes, _ = await pull_all(client, since=first["cursor"])
    by_uuid = {c["client_uuid"]: c for c in changes}
    assert by_uuid[item]["deleted_at"] is not None
    assert recipe not in by_uuid


async def test_food_validation(client):
    result = await push(
        client,
        change("food", new_uuid(), food(p=120)),                 # белка больше 100 г на 100 г
        change("food", new_uuid(), food(kcal=950)),              # больше 900 ккал на 100 г
        change("food", new_uuid(), food(barcode="46abc")),       # штрихкод не из цифр
        change("food_entry", new_uuid(), entry(grams=0)),        # нулевой вес
        change("water_entry", new_uuid(), {"entry_date": "2025-03-01", "entry_time": "09:00", "amount_ml": 6000}),
        change("meal_type", new_uuid(), {"name": "Без времени", "reminder_enabled": True}),
        change("food", new_uuid(), food(kcal=99.999)),           # лишние знаки округляются
    )
    assert [r["status"] for r in result["results"]] == ["rejected"] * 6 + ["applied"]


async def test_other_users_refs_rejected(client, as_user):
    food_uuid, meal_uuid = new_uuid(), new_uuid()
    await push(client, change("food", food_uuid, food()), change("meal_type", meal_uuid, {"name": "Обед"}))

    as_user(client.users.bob)
    result = await push(
        client,
        change("food_entry", new_uuid(), entry(food_uuid=food_uuid)),
        change("food_entry", new_uuid(), entry(meal_type_uuid=meal_uuid)),
        change("recipe_item", new_uuid(), {"recipe_uuid": new_uuid(), "ingredient_uuid": food_uuid, "grams": 10}),
    )
    assert [r["status"] for r in result["results"]] == ["rejected"] * 3
    assert all(r["reason"].startswith("missing_ref") for r in result["results"])

    response = await client.get("/api/journal/foods/search")
    assert response.status_code == 200
    assert response.json()["items"] == []


# ---------------------------------------------------------------- серверные итоги

async def test_calendar_and_day_count_kcal(client):
    await push(
        client,
        change("food_entry", new_uuid(), entry("2025-03-01", kcal=500.4)),
        change("food_entry", new_uuid(), entry("2025-03-01", kcal=300.3)),
        change("food_entry", new_uuid(), entry("2025-03-02", kcal=100)),
        change("water_entry", new_uuid(), {"entry_date": "2025-03-01", "entry_time": "09:00", "amount_ml": 250}),
        change("water_entry", new_uuid(), {"entry_date": "2025-03-01", "entry_time": "12:00", "amount_ml": 500}),
    )
    month = (await client.get("/api/journal/calendar", params={"month": "2025-03"})).json()
    kcal = {d["date"]: d["kcal"] for d in month["days"]}
    assert kcal["2025-03-01"] == 801 and kcal["2025-03-02"] == 100 and kcal["2025-03-03"] == 0

    day = (await client.get("/api/journal/day", params={"date": "2025-03-01"})).json()
    assert day["summary"]["kcal"] == 801
    assert len(day["food_entries"]) == 2 and day["water_ml"] == 750


async def test_diet_summary(client):
    await pull_all(client)  # создаёт настройки
    settings_uuid = seed_uuid(client.users.alice.id, "settings")
    await push(
        client,
        change("settings", settings_uuid, {"timezone": "Europe/Moscow", "kcal_goal": 2000, "water_ml_goal": 2000,
                                           "seed_version": 2}, at=datetime.now(timezone.utc).isoformat()),
        change("food_entry", new_uuid(), entry("2025-03-01", kcal=1000)),
        change("food_entry", new_uuid(), entry("2025-03-03", kcal=2000)),
        change("water_entry", new_uuid(), {"entry_date": "2025-03-03", "entry_time": "09:00", "amount_ml": 300}),
    )
    response = await client.get("/api/journal/diet/summary", params={"from": "2025-03-01", "to": "2025-03-03"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert [d["kcal"] for d in body["days"]] == [1000, 0, 2000]
    assert body["total"]["kcal"] == 3000 and body["total"]["water_ml"] == 300
    # Среднее - по заполненным дням
    assert body["average"]["kcal"] == 1500
    assert body["goals"]["kcal"] == 2000 and body["goals"]["water_ml"] == 2000

    bad = await client.get("/api/journal/diet/summary", params={"from": "2025-03-03", "to": "2025-03-01"})
    assert bad.status_code == 422
    too_long = await client.get("/api/journal/diet/summary", params={"from": "2024-01-01", "to": "2025-12-31"})
    assert too_long.status_code == 422


async def test_food_search_order_and_recipe_recalc(client):
    recipe, rice, chicken = new_uuid(), new_uuid(), new_uuid()
    await push(
        client,
        change("food", rice, food("Рис", 130, 2.7, 0.3, 28, use_count=1)),
        change("food", chicken, food("Курица", 165, 31, 3.6, 0, use_count=10)),
        # КБЖУ рецепта от клиента неверные - сервер пересчитывает из ингредиентов
        change("food", recipe, food("Плов с курицей", 1, 1, 1, 1, is_recipe=True, source="recipe", use_count=5)),
        change("recipe_item", new_uuid(), {"recipe_uuid": recipe, "ingredient_uuid": rice, "grams": 200}),
        change("recipe_item", new_uuid(), {"recipe_uuid": recipe, "ingredient_uuid": chicken, "grams": 100}),
    )
    body = (await client.get("/api/journal/foods/search")).json()
    assert [i["name"] for i in body["items"]] == ["Курица", "Плов с курицей", "Рис"]
    pilaf = body["items"][1]
    assert pilaf["kcal_100"] == 141.67 and pilaf["is_recipe"] is True

    found = (await client.get("/api/journal/foods/search", params={"q": "кур"})).json()
    assert [i["name"] for i in found["items"]] == ["Курица", "Плов с курицей"]

    page = (await client.get("/api/journal/foods/search", params={"limit": 2})).json()
    assert len(page["items"]) == 2 and page["has_more"] is True
