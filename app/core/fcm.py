import firebase_admin
from firebase_admin import credentials, messaging
from typing import Optional
import os
from app.core.config import FIREBASE_SERVICE_ACCOUNT_PATH

# Инициализация Firebase Admin SDK
# Мы инициализируем его один раз при импорте модуля
try:
    if not firebase_admin._apps:
        if os.path.exists(FIREBASE_SERVICE_ACCOUNT_PATH):
            cred = credentials.Certificate(FIREBASE_SERVICE_ACCOUNT_PATH)
            firebase_admin.initialize_app(cred)
        else:
            print(f"WARNING: Firebase service account file not found at {FIREBASE_SERVICE_ACCOUNT_PATH}")
except Exception as e:
    print(f"ERROR: Failed to initialize Firebase Admin SDK: {e}")

async def send_fcm_notification(
    token: str, 
    title: str, 
    body: str, 
    data: Optional[dict] = None,
    sender_id: Optional[int] = None
):
    """
    Отправляет пуш-уведомление через Firebase Cloud Messaging (HTTP v1 API)
    используя Firebase Admin SDK.
    """
    if not firebase_admin._apps:
        print("WARNING: Firebase Admin SDK not initialized, skipping notification")
        return False

    # Подготовка данных для уведомления
    # Все значения в data должны быть строками для Firebase Admin SDK
    fcm_data = {}
    if data:
        for k, v in data.items():
            fcm_data[k] = str(v)
    
    if sender_id:
        fcm_data["sender_id"] = str(sender_id)
    
    fcm_data["type"] = "new_message"
    fcm_data["click_action"] = "FLUTTER_NOTIFICATION_CLICK"

    # Создание объекта уведомления
    notification = messaging.Notification(
        title=title,
        body=body,
    )

    # Настройки для Android (каналы, теги)
    tag = f"user_msg_{sender_id}" if sender_id else "general_msg"
    android_config = messaging.AndroidConfig(
        priority='high',
        notification=messaging.AndroidNotification(
            tag=tag,
            channel_id="messages",
            sound="default"
        )
    )

    # Настройки для iOS (APNS)
    apns_config = messaging.APNSConfig(
        payload=messaging.APNSPayload(
            aps=messaging.Aps(
                sound="default",
                thread_id=str(sender_id) if sender_id else None
            )
        )
    )

    # Создание сообщения
    message = messaging.Message(
        notification=notification,
        data=fcm_data,
        token=token,
        android=android_config,
        apns=apns_config
    )

    try:
        # Отправка сообщения (синхронный вызов в Admin SDK, 
        # но в FastAPI обычно этого достаточно, либо можно обернуть в run_in_executor)
        response = messaging.send(message)
        print(f"Successfully sent message: {response}")
        return True
    except Exception as e:
        print(f"FCM request failed: {e}")
        return False
