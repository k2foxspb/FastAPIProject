"""
Реестр синхронизируемых сущностей журнала.

Для каждой сущности описано: модель, pydantic-схема данных, ссылки на другие
сущности (data["*_uuid"] -> FK-колонка, разрешается строго в пределах user_id),
полиморфные ссылки (тип + uuid), порядок применения (родители раньше детей),
допустимые операции и хуки дополнительной проверки.

Новые фазы (диета, финансы, цели) регистрируют свои сущности здесь же.
"""
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.journal import (
    JournalAccount, JournalAttachment, JournalBudget, JournalDiaryEntry, JournalEvent,
    JournalEventOccurrence, JournalFinanceCategory, JournalFood,
    JournalFoodEntry, JournalMealType, JournalRecipeItem, JournalReminder, JournalSettings,
    JournalTracker, JournalTrackerValue, JournalTransaction, JournalWaterEntry,
    JournalImportBatch, JournalImportProfile, JournalImportRule,
)
from app.schemas.journal.diet import FoodData, FoodEntryData, MealTypeData, RecipeItemData, WaterEntryData
from app.schemas.journal.finance import (
    AccountData, BudgetData, FinanceCategoryData, ImportBatchData, ImportProfileData,
    ImportRuleData, TransactionData,
)
from app.schemas.journal.sync import (
    AttachmentData, DiaryEntryData, EventData, EventOccurrenceData, ReminderData, SettingsData,
    TrackerData, TrackerValueData,
)

# validate(db, user_id, existing, values, resolved) -> причина отказа или None
ValidateHook = Callable[[AsyncSession, int, Any, dict, dict], Awaitable[str | None]]
AfterApplyHook = Callable[[int, list[Any]], None]


@dataclass(frozen=True)
class RefSpec:
    field: str      # ключ в data, например "event_uuid"
    column: str     # FK-колонка модели, например "event_id"
    target: str     # имя сущности-родителя в реестре
    # Что делать с дочерней записью при удалении родителя: "cascade" - удалить,
    # "set_null" - обнулить ссылку (запись о еде остаётся при удалении продукта).
    on_delete: str = "cascade"


@dataclass(frozen=True)
class PolyRefSpec:
    type_field: str               # колонка с типом, например "target_type"
    uuid_field: str               # колонка с client_uuid, например "target_uuid"
    targets: dict[str, str]       # значение типа -> имя сущности в реестре


@dataclass
class EntitySpec:
    name: str
    model: Any
    schema: Any
    order: int
    refs: list[RefSpec] = field(default_factory=list)
    poly_refs: list[PolyRefSpec] = field(default_factory=list)
    ops: frozenset[str] = frozenset({"upsert", "delete"})
    validate: ValidateHook | None = None
    after_apply: AfterApplyHook | None = None


REGISTRY: dict[str, EntitySpec] = {}


def register(spec: EntitySpec) -> EntitySpec:
    REGISTRY[spec.name] = spec
    return spec


def get_spec(name: str) -> EntitySpec | None:
    return REGISTRY.get(name)


def ordered_specs() -> list[EntitySpec]:
    return sorted(REGISTRY.values(), key=lambda s: s.order)


def children_of(name: str) -> list[tuple[EntitySpec, RefSpec]]:
    return [(s, r) for s in REGISTRY.values() for r in s.refs if r.target == name]


def poly_children_of(name: str) -> list[tuple[EntitySpec, PolyRefSpec, str]]:
    result = []
    for s in REGISTRY.values():
        for p in s.poly_refs:
            for type_value, target in p.targets.items():
                if target == name:
                    result.append((s, p, type_value))
    return result


# ---------------------------------------------------------------- хуки проверки

async def _validate_settings(db: AsyncSession, user_id: int, existing, values: dict, resolved: dict) -> str | None:
    if existing is not None:
        return None
    other = (await db.execute(
        select(JournalSettings.id).where(JournalSettings.user_id == user_id)
    )).first()
    return "settings_exists" if other else None


async def _validate_occurrence(db: AsyncSession, user_id: int, existing, values: dict, resolved: dict) -> str | None:
    stmt = select(JournalEventOccurrence.id).where(
        JournalEventOccurrence.user_id == user_id,
        JournalEventOccurrence.event_id == values["event_id"],
        JournalEventOccurrence.occurrence_date == values["occurrence_date"],
    )
    if existing is not None:
        stmt = stmt.where(JournalEventOccurrence.id != existing.id)
    other = (await db.execute(stmt)).first()
    return "duplicate_occurrence" if other else None


async def _validate_tracker_value(db: AsyncSession, user_id: int, existing, values: dict, resolved: dict) -> str | None:
    tracker = resolved.get("tracker_uuid")
    if tracker is None:
        return None
    num = values.get("num_value")
    if tracker.value_type == "text":
        if not values.get("text_value"):
            return "invalid: text_value обязателен для текстового трекера"
        return None
    if num is None:
        return "invalid: num_value обязателен"
    if tracker.value_type == "bool" and num not in (Decimal(0), Decimal(1)):
        return "invalid: для трекера да/нет допустимы 0 и 1"
    if tracker.value_type == "duration" and num < 0:
        return "invalid: длительность не может быть отрицательной"
    if tracker.value_type == "scale":
        lo, hi = tracker.scale_min, tracker.scale_max
        if (lo is not None and num < Decimal(lo)) or (hi is not None and num > Decimal(hi)):
            return "invalid: значение вне шкалы трекера"
    return None


async def _validate_recipe_item(db: AsyncSession, user_id: int, existing, values: dict, resolved: dict) -> str | None:
    recipe = resolved.get("recipe_uuid")
    ingredient = resolved.get("ingredient_uuid")
    if recipe is not None and not recipe.is_recipe:
        return "invalid: recipe_uuid должен ссылаться на рецепт"
    # Вложенные рецепты не поддерживаются - так не бывает циклов при расчёте КБЖУ
    if ingredient is not None and ingredient.is_recipe:
        return "invalid: ингредиентом не может быть другой рецепт"
    return None


async def _validate_transaction(db: AsyncSession, user_id: int, existing, values: dict, resolved: dict) -> str | None:
    if existing is None and values.get("account_id") is None:
        return "invalid: операция должна быть привязана к счёту"
    if values.get("direction") == "transfer":
        if values.get("to_account_id") is None or values.get("to_account_id") == values.get("account_id"):
            return "invalid: перевод требует два разных счёта"
        if values.get("category_id") is not None:
            return "invalid: перевод не может иметь категорию"
    elif values.get("to_account_id") is not None:
        return "invalid: счёт-получатель допустим только для перевода"
    category = resolved.get("category_uuid")
    if category is not None and category.kind != values.get("direction"):
        return "invalid: категория не соответствует типу операции"
    return None


async def _validate_finance_category(db: AsyncSession, user_id: int, existing, values: dict, resolved: dict) -> str | None:
    parent = resolved.get("parent_uuid")
    if parent is None:
        return None
    if existing is not None and parent.id == existing.id:
        return "invalid: категория не может быть родителем самой себя"
    if parent.kind != values.get("kind"):
        return "invalid: родительская категория другого типа"
    return None


async def _validate_expense_category(db: AsyncSession, user_id: int, existing, values: dict, resolved: dict) -> str | None:
    category = resolved.get("category_uuid")
    if category is not None and category.kind != "expense":
        return "invalid: нужна категория расходов"
    return None


def _schedule_budget_check(user_id: int, changes: list[Any]) -> None:
    """Запускает проверку бюджетов после commit, не блокируя sync при сбое брокера."""
    months = set()
    for change in changes:
        transaction_date = (change.data or {}).get("transaction_date")
        if transaction_date:
            months.add(str(transaction_date)[:7])
    if not months:
        return
    try:
        from app.core.celery_app import celery_app
        celery_app.send_task("journal.check_budgets", args=[user_id, sorted(months)], retry=False)
    except Exception:
        from loguru import logger
        logger.exception("Не удалось поставить проверку бюджета в очередь")


# ---------------------------------------------------------------- регистрация фазы 1

register(EntitySpec(
    name="settings", model=JournalSettings, schema=SettingsData, order=0,
    ops=frozenset({"upsert"}), validate=_validate_settings,
))
register(EntitySpec(name="tracker", model=JournalTracker, schema=TrackerData, order=10))
register(EntitySpec(
    name="event", model=JournalEvent, schema=EventData, order=20,
    poly_refs=[PolyRefSpec("ref_type", "ref_uuid", {"tracker": "tracker", "account": "account"})],
))
register(EntitySpec(
    name="event_occurrence", model=JournalEventOccurrence, schema=EventOccurrenceData, order=30,
    refs=[RefSpec("event_uuid", "event_id", "event")], validate=_validate_occurrence,
))
register(EntitySpec(
    name="reminder", model=JournalReminder, schema=ReminderData, order=30,
    poly_refs=[PolyRefSpec("target_type", "target_uuid", {"event": "event", "tracker": "tracker"})],
))
register(EntitySpec(name="diary_entry", model=JournalDiaryEntry, schema=DiaryEntryData, order=20))
register(EntitySpec(
    name="tracker_value", model=JournalTrackerValue, schema=TrackerValueData, order=30,
    refs=[RefSpec("tracker_uuid", "tracker_id", "tracker")], validate=_validate_tracker_value,
))

# ---------------------------------------------------------------- регистрация фазы 2 (диета)

register(EntitySpec(name="meal_type", model=JournalMealType, schema=MealTypeData, order=10))
register(EntitySpec(name="food", model=JournalFood, schema=FoodData, order=10))
register(EntitySpec(
    name="recipe_item", model=JournalRecipeItem, schema=RecipeItemData, order=30,
    refs=[
        RefSpec("recipe_uuid", "recipe_id", "food"),
        RefSpec("ingredient_uuid", "ingredient_id", "food"),
    ],
    validate=_validate_recipe_item,
))
register(EntitySpec(
    name="food_entry", model=JournalFoodEntry, schema=FoodEntryData, order=30,
    refs=[
        RefSpec("meal_type_uuid", "meal_type_id", "meal_type", on_delete="set_null"),
        RefSpec("food_uuid", "food_id", "food", on_delete="set_null"),
    ],
))
register(EntitySpec(name="water_entry", model=JournalWaterEntry, schema=WaterEntryData, order=20))

register(EntitySpec(
    name="attachment", model=JournalAttachment, schema=AttachmentData, order=90,
    poly_refs=[PolyRefSpec("owner_type", "owner_uuid", {
        "diary_entry": "diary_entry", "tracker_value": "tracker_value", "event": "event",
        "food_entry": "food_entry", "food": "food",
    })],
    ops=frozenset({"delete"}),
))

# ---------------------------------------------------------------- регистрация фазы 3 (финансы и импорт)

register(EntitySpec(name="account", model=JournalAccount, schema=AccountData, order=10))
register(EntitySpec(
    name="finance_category", model=JournalFinanceCategory, schema=FinanceCategoryData, order=10,
    refs=[RefSpec("parent_uuid", "parent_id", "finance_category", on_delete="set_null")],
    validate=_validate_finance_category,
))
register(EntitySpec(
    name="transaction", model=JournalTransaction, schema=TransactionData, order=30,
    refs=[
        RefSpec("account_uuid", "account_id", "account", on_delete="set_null"),
        RefSpec("to_account_uuid", "to_account_id", "account", on_delete="set_null"),
        RefSpec("category_uuid", "category_id", "finance_category", on_delete="set_null"),
    ],
    validate=_validate_transaction,
    after_apply=_schedule_budget_check,
))
register(EntitySpec(
    name="budget", model=JournalBudget, schema=BudgetData, order=30,
    refs=[RefSpec("category_uuid", "category_id", "finance_category", on_delete="set_null")],
    validate=_validate_expense_category,
))
register(EntitySpec(
    name="import_profile", model=JournalImportProfile, schema=ImportProfileData, order=20,
))
register(EntitySpec(
    name="import_rule", model=JournalImportRule, schema=ImportRuleData, order=30,
    refs=[RefSpec("category_uuid", "category_id", "finance_category", on_delete="set_null")],
    validate=_validate_expense_category,
))
register(EntitySpec(
    name="import_batch", model=JournalImportBatch, schema=ImportBatchData, order=40,
    refs=[
        RefSpec("account_uuid", "account_id", "account", on_delete="set_null"),
        RefSpec("profile_uuid", "profile_id", "import_profile", on_delete="set_null"),
    ],
    ops=frozenset(),
))

# Допустимые типы владельцев вложений (POST /api/journal/attachments).
ATTACHMENT_OWNER_TYPES = REGISTRY["attachment"].poly_refs[0].targets
