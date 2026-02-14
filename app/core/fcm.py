import httpx
import json
import os
from typing import Optional

# FCM Legacy API Server Key (менее безопасно, но проще в настройке без сервисного аккаунта)
# В идеале нужно использовать HTTP v1 API с сервисным аккаунтом, но для быстрой проверки часто используют Legacy
FCM_SERVER_KEY = os.getenv("FCM_SERVER_KEY")

async def send_fcm_notification(
    token: str, 
    title: str, 
    body: str, 
    data: Optional[dict] = None,
    sender_id: Optional[int] = None
):
    """
    Отправляет пуш-уведомление через Firebase Cloud Messaging (Legacy API).
    """
    if not FCM_SERVER_KEY:
        print("WARNING: FCM_SERVER_KEY not set, skipping notification")
        return False

    url = "https://fcm.googleapis.com/fcm/send"
    headers = {
        "Authorization": f"key={FCM_SERVER_KEY}",
        "Content-Type": "application/json"
    }

    # Группировка (Android использует tag, iOS использует thread-id)
    tag = f"user_msg_{sender_id}" if sender_id else "general_msg"

    payload = {
        "to": token,
        "notification": {
            "title": title,
            "body": body,
            "sound": "default",
            "tag": tag,  # Группировка для Android
            "android_channel_id": "messages"
        },
        "data": {
            "click_action": "FLUTTER_NOTIFICATION_CLICK", # Для совместимости с некоторыми плагинами
            "type": "new_message",
            "sender_id": sender_id,
            **(data or {})
        },
        "priority": "high"
    }

    # Добавляем thread-id для iOS группировки
    if sender_id:
        payload["notification"]["thread-id"] = str(sender_id)

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code == 200:
                print(f"FCM notification sent successfully to {token[:10]}...")
                return True
            else:
                print(f"FCM error: {response.status_code} - {response.text}")
                return False
        except Exception as e:
            print(f"FCM request failed: {e}")
            return False
