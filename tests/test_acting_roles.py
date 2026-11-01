"""
Юнит-тесты для проверки прав назначения исполняющего обязанности (и.о.)
должности (app.core.roles.can_assign_acting). Используют должности по
умолчанию (DEFAULT_POSITIONS): owner(0) > shop_chief(1) > section_chief(2)
> master(3) > assistant_master(4) > worker(5).
"""
from app.core.roles import (
    can_assign_acting,
    ROLE_OWNER,
    ROLE_SHOP_CHIEF,
    ROLE_SECTION_CHIEF,
    ROLE_MASTER,
    ROLE_ASSISTANT_MASTER,
    ROLE_WORKER,
)


def test_higher_can_assign_acting_for_lower_role():
    # Начальник цеха может назначить рабочего и.о. мастера участка -
    # и acting_role (master), и исходная роль назначаемого (worker) строго ниже него.
    assert can_assign_acting(ROLE_SHOP_CHIEF, ROLE_MASTER, ROLE_WORKER) is True


def test_cannot_assign_acting_role_above_or_equal_to_self():
    # Начальник участка не может назначить и.о. начальника цеха (acting_role выше него).
    assert can_assign_acting(ROLE_SECTION_CHIEF, ROLE_SHOP_CHIEF, ROLE_WORKER) is False
    # Нельзя назначить и.о. на свою же должность.
    assert can_assign_acting(ROLE_SECTION_CHIEF, ROLE_SECTION_CHIEF, ROLE_WORKER) is False


def test_cannot_assign_acting_when_assignee_not_lower_than_assigner():
    # Назначаемый и.о. должен иметь исходную должность строго ниже назначающего.
    assert can_assign_acting(ROLE_SECTION_CHIEF, ROLE_MASTER, ROLE_SECTION_CHIEF) is False
    assert can_assign_acting(ROLE_SECTION_CHIEF, ROLE_MASTER, ROLE_SHOP_CHIEF) is False


def test_owner_can_assign_any_acting_role():
    assert can_assign_acting(ROLE_OWNER, ROLE_SHOP_CHIEF, ROLE_WORKER) is True
    assert can_assign_acting(ROLE_OWNER, ROLE_ASSISTANT_MASTER, ROLE_WORKER) is True


def test_invalid_acting_role_rejected():
    assert can_assign_acting(ROLE_OWNER, "not_a_role", ROLE_WORKER) is False
