"""Тесты целей журнала: прогресс по периодам и направлениям, экранирование CSV, кэш штрихкодов."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.models.journal import JournalBarcodeCache, JournalFood, JournalGoal, JournalWaterEntry
from app.services.journal import barcode as barcode_service
from app.services.journal import goals as goals_service
from app.services.journal.export import escape_cell, rows_to_csv


def _goal(**overrides) -> JournalGoal:
    values = dict(
        user_id=1, client_uuid="g1", title="Вода", source_type="water", target_value=Decimal("2000"),
        period="day", start_date=date(2026, 11, 1), direction="reach", status="active",
    )
    values.update(overrides)
    return JournalGoal(**values)


def test_period_bounds_day_week_month():
    today = date(2026, 11, 4)  # среда
    assert goals_service.period_bounds(_goal(period="day"), today) == (today, today)
    assert goals_service.period_bounds(_goal(period="week"), today) == (date(2026, 11, 2), date(2026, 11, 8))
    assert goals_service.period_bounds(_goal(period="month"), today) == (date(2026, 11, 1), date(2026, 11, 30))


def test_period_bounds_none_uses_goal_range():
    goal = _goal(period="none", start_date=date(2026, 10, 1), deadline=date(2026, 12, 31))
    assert goals_service.period_bounds(goal, date(2026, 11, 4)) == (date(2026, 10, 1), date(2026, 12, 31))


def test_evaluate_reach_and_not_exceed():
    reach = _goal(target_value=Decimal("100"), direction="reach")
    assert goals_service.evaluate(reach, Decimal("50")) == (50.0, 50.0, False)
    assert goals_service.evaluate(reach, Decimal("120")) == (120.0, 120.0, True)

    limit = _goal(target_value=Decimal("1000"), direction="not_exceed")
    assert goals_service.evaluate(limit, Decimal("800")) == (80.0, 800.0, True)
    assert goals_service.evaluate(limit, Decimal("1200")) == (120.0, 1200.0, False)


def test_evaluate_no_data_is_zero_progress():
    assert goals_service.evaluate(_goal(target_value=Decimal("100")), None) == (0.0, 0.0, False)


def test_percent_is_capped():
    percent, _, _ = goals_service.evaluate(_goal(target_value=Decimal("1")), Decimal("100000"))
    assert percent == 1000.0


@pytest.mark.asyncio
async def test_water_progress_sums_entries_in_period(session_maker, users):
    today = date(2026, 11, 4)
    async with session_maker() as db:
        db.add_all([
            JournalWaterEntry(user_id=users.alice.id, client_uuid="w1", entry_date=today,
                              entry_time=datetime(2026, 11, 4, 9).time(), amount_ml=500),
            JournalWaterEntry(user_id=users.alice.id, client_uuid="w2", entry_date=today,
                              entry_time=datetime(2026, 11, 4, 12).time(), amount_ml=750),
            # Другой день - не входит в дневную цель
            JournalWaterEntry(user_id=users.alice.id, client_uuid="w3", entry_date=date(2026, 11, 3),
                              entry_time=datetime(2026, 11, 3, 12).time(), amount_ml=900),
            # Чужая запись - не учитывается
            JournalWaterEntry(user_id=users.bob.id, client_uuid="w4", entry_date=today,
                              entry_time=datetime(2026, 11, 4, 12).time(), amount_ml=1000),
        ])
        await db.commit()
        goal = _goal(user_id=users.alice.id, target_value=Decimal("2000"), period="day")
        progress = await goals_service.goal_progress(db, users.alice.id, goal, today)
    assert progress.current == 1250.0
    assert progress.percent == 62.5
    assert progress.achieved is False
    assert progress.period_start == today


@pytest.mark.asyncio
async def test_goal_progress_for_missing_tracker_is_zero(session_maker, users):
    async with session_maker() as db:
        goal = _goal(user_id=users.alice.id, source_type="tracker", source_uuid="missing", period="day")
        progress = await goals_service.goal_progress(db, users.alice.id, goal, date(2026, 11, 4))
    assert progress.current == 0.0
    assert progress.achieved is False


def test_escape_cell_blocks_formula_injection():
    assert escape_cell("=HYPERLINK(\"http://x\")") == "'=HYPERLINK(\"http://x\")"
    assert escape_cell("+1+1") == "'+1+1"
    assert escape_cell("-cmd") == "'-cmd"
    assert escape_cell("@SUM(A1)") == "'@SUM(A1)"


def test_escape_cell_keeps_numbers_and_plain_text():
    assert escape_cell(Decimal("-12.50")) == "-12.50"
    assert escape_cell(-3) == "-3"
    assert escape_cell(None) == ""
    assert escape_cell("Продукты") == "Продукты"


def test_rows_to_csv_escapes_and_has_bom():
    text = rows_to_csv(["Описание", "Сумма"], [["=evil()", Decimal("-5.00")], ["Кофе", Decimal("120")]])
    assert text.startswith("\ufeff")
    lines = text.lstrip("\ufeff").split("\r\n")
    assert lines[0] == "Описание;Сумма"
    assert lines[1] == "'=evil();-5.00"
    assert lines[2] == "Кофе;120"


def _off_product(name="Печенье", kcal="450"):
    return {
        "product_name": name,
        "brands": "Бренд, Другой",
        "serving_quantity": "30",
        "nutriments": {"energy-kcal_100g": kcal, "proteins_100g": 6, "fat_100g": 20, "carbohydrates_100g": 60},
    }


@pytest.mark.asyncio
async def test_barcode_cache_hit_skips_network(session_maker, users, monkeypatch):
    async def must_not_call(barcode):
        raise AssertionError("Open Food Facts не должен вызываться при свежем кэше")

    monkeypatch.setattr(barcode_service, "fetch_open_food_facts", must_not_call)
    async with session_maker() as db:
        db.add(JournalBarcodeCache(barcode="4600000000001", found=True, name="Чай", brand="Бренд",
                                   kcal_100=Decimal("1"), protein_100=Decimal("0"), fat_100=Decimal("0"),
                                   carbs_100=Decimal("0.5"), fetched_at=datetime.now(timezone.utc)))
        await db.commit()
        food = await barcode_service.resolve_barcode(db, users.alice.id, "4600000000001")
        await db.commit()
    assert food.name == "Чай"
    assert food.source == "off"


@pytest.mark.asyncio
async def test_barcode_stale_cache_refetches(session_maker, users, monkeypatch):
    calls = []

    async def fake_fetch(barcode):
        calls.append(barcode)
        return _off_product("Свежий")

    monkeypatch.setattr(barcode_service, "fetch_open_food_facts", fake_fetch)
    async with session_maker() as db:
        db.add(JournalBarcodeCache(barcode="4600000000002", found=True, name="Старый",
                                   fetched_at=datetime.now(timezone.utc) - timedelta(days=60)))
        await db.commit()
        food = await barcode_service.resolve_barcode(db, users.alice.id, "4600000000002")
        await db.commit()
    assert calls == ["4600000000002"]
    assert food.name == "Свежий"


@pytest.mark.asyncio
async def test_barcode_miss_is_cached_as_not_found(session_maker, users, monkeypatch):
    async def fake_fetch(barcode):
        return None

    monkeypatch.setattr(barcode_service, "fetch_open_food_facts", fake_fetch)
    async with session_maker() as db:
        food = await barcode_service.resolve_barcode(db, users.alice.id, "4600000000003")
        await db.commit()
        cached = await db.get(JournalBarcodeCache, "4600000000003")
    assert food is None
    assert cached is not None and cached.found is False


@pytest.mark.asyncio
async def test_barcode_personal_copy_is_not_duplicated(session_maker, users, monkeypatch):
    async def fake_fetch(barcode):
        return _off_product()

    monkeypatch.setattr(barcode_service, "fetch_open_food_facts", fake_fetch)
    async with session_maker() as db:
        first = await barcode_service.resolve_barcode(db, users.alice.id, "4600000000004")
        await db.commit()
        second = await barcode_service.resolve_barcode(db, users.alice.id, "4600000000004")
        await db.commit()
    assert first.client_uuid == second.client_uuid


@pytest.mark.asyncio
async def test_barcode_unavailable_does_not_cache(session_maker, users, monkeypatch):
    async def failing_fetch(barcode):
        raise barcode_service.BarcodeUnavailable("timeout")

    monkeypatch.setattr(barcode_service, "fetch_open_food_facts", failing_fetch)
    async with session_maker() as db:
        with pytest.raises(barcode_service.BarcodeUnavailable):
            await barcode_service.resolve_barcode(db, users.alice.id, "4600000000005")
        await db.rollback()
        assert await db.get(JournalBarcodeCache, "4600000000005") is None


def test_normalize_barcode_rejects_bad_codes():
    assert barcode_service.normalize_barcode(" 4600000000001 ") == "4600000000001"
    assert barcode_service.normalize_barcode("abc12345") is None
    assert barcode_service.normalize_barcode("1234") is None
    assert barcode_service.normalize_barcode("1" * 20) is None


def test_goal_data_rejects_deadline_before_start():
    from pydantic import ValidationError
    from app.schemas.journal.goals import GoalData

    with pytest.raises(ValidationError):
        GoalData(client_uuid="g1", title="Цель", source_type="water", target_value=Decimal("1"),
                 start_date=date(2026, 11, 10), deadline=date(2026, 11, 1))
