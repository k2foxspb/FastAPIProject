"""
Единая точка применения пользовательских настроек уведомлений:
- отключение оповещений по группам (объявления, новости, чаты и т.д.);
- "тихие часы" (ночное время), когда уведомления приходят без звука.

Любой роутер, рассылающий push/websocket-уведомления, должен использовать
dispatch_notification() вместо прямого вызова send_fcm_notification(), чтобы
настройки пользователя учитывались одинаково во всех местах.
"""
import asyncio
from datetime import datetime, time as dt_time
from typing import Optional

from app.core.fcm import send_fcm_notification

# Группы оповещений, которые пользователь может включать/отключать по
# отдельности в настройках приложения. Код группы используется и как
# android_channel_id по умолчанию, и как ключ в disabled_groups.
NOTIFICATION_GROUPS: dict[str, str] = {
    "announcements": "Объявления",
    "news": "Новости",
    "chat": "Личные сообщения",
    "group_chat": "Групповые чаты",
    "statements": "Заявления",
    "timesheet": "Табель и продукция",
    "acting": "Назначения и.о.",
    "friends": "Заявки в друзья",
}

DEFAULT_QUIET_HOURS_START = "22:00"
DEFAULT_QUIET_HOURS_END = "07:00"


def _parse_hhmm(value: str | None) -> Optional[dt_time]:
    if not value:
        return None
    try:
        hours, minutes = value.split(":")
        return dt_time(hour=int(hours), minute=int(minutes))
    except (ValueError, AttributeError):
        return None


def get_notification_settings(user) -> dict:
    """
    Возвращает настройки уведомлений пользователя с подставленными
    значениями по умолчанию (если пользователь ещё ничего не настраивал).
    """
    settings = user.notification_settings or {}
    return {
        "disabled_groups": list(settings.get("disabled_groups") or []),
        "quiet_hours_enabled": bool(settings.get("quiet_hours_enabled", False)),
        "quiet_hours_start": settings.get("quiet_hours_start") or DEFAULT_QUIET_HOURS_START,
        "quiet_hours_end": settings.get("quiet_hours_end") or DEFAULT_QUIET_HOURS_END,
    }


def is_group_enabled(user, group: str) -> bool:
    """Проверяет, не отключил ли пользователь уведомления указанной группы."""
    settings = get_notification_settings(user)
    return group not in settings["disabled_groups"]


def is_quiet_hours_now(user, now: Optional[datetime] = None) -> bool:
    """
    Проверяет, попадает ли текущее время в "тихие часы" пользователя
    (ночное время, когда уведомления должны приходить без звука).
    Корректно обрабатывает интервал, переходящий через полночь
    (например 22:00 - 07:00).
    """
    settings = get_notification_settings(user)
    if not settings["quiet_hours_enabled"]:
        return False

    start = _parse_hhmm(settings["quiet_hours_start"])
    end = _parse_hhmm(settings["quiet_hours_end"])
    if start is None or end is None:
        return False

    current_time = (now or datetime.now()).time()

    if start <= end:
        # Обычный интервал в пределах одних суток, например 13:00 - 15:00
        return start <= current_time <= end
    # Интервал, переходящий через полночь, например 22:00 - 07:00
    return current_time >= start or current_time <= end


def dispatch_notification(
    user,
    group: str,
    title: str,
    body: str,
    data: Optional[dict] = None,
    sender_id: Optional[int] = None,
    sender_avatar: Optional[str] = None,
    ws_manager=None,
    ws_message: Optional[dict] = None,
) -> None:
    """
    Отправляет пользователю push- (и опционально websocket-) уведомление
    с учётом его настроек: не отправляет push вовсе, если группа отключена,
    и отправляет его без звука, если сейчас "тихие часы".
    Запускает отправку как фоновую задачу (asyncio.create_task), поэтому
    вызывающий код не блокируется ожиданием ответа FCM.
    """
    if ws_manager is not None and ws_message is not None:
        asyncio.create_task(ws_manager.send_personal_message(ws_message, user.id))

    if not is_group_enabled(user, group):
        return

    if not getattr(user, "fcm_token", None):
        return

    silent = is_quiet_hours_now(user)
    asyncio.create_task(send_fcm_notification(
        token=user.fcm_token,
        title=title,
        body=body,
        data={**(data or {}), "notification_group": group},
        sender_id=sender_id,
        sender_avatar=sender_avatar,
        silent=silent,
    ))
