"""Применение пользовательских правил категоризации."""


def match_rule(item: dict, rules: list) -> object | None:
    for rule in sorted(rules, key=lambda current: (current.priority, current.created_at)):
        if not rule.enabled or rule.deleted_at is not None:
            continue
        value = item.get(rule.match_field) or ""
        if rule.match_text.casefold() in str(value).casefold():
            return rule.category_id
    return None