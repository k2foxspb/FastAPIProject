import firebase_admin
import asyncio
from loguru import logger
from firebase_admin import credentials, messaging
from typing import Optional
import os
from app.core.config import FIREBASE_SERVICE_ACCOUNT_PATH

# Инициализация Firebase Admin SDK
# Мы инициализируем его один раз при импорте модуля
try:
    if not firebase_admin._apps:
        # Пытаемся найти файл по абсолютному пути, если относительный не сработал
        abs_path = os.path.abspath(FIREBASE_SERVICE_ACCOUNT_PATH)
        if os.path.exists(abs_path):
            logger.info(f"Initializing Firebase Admin SDK with service account from {abs_path}")
            cred = credentials.Certificate(abs_path)
            firebase_admin.initialize_app(cred)
        else:
            logger.warning(f"Firebase service account file NOT found at {abs_path}. FCM notifications will be disabled.")
except Exception as e:
    logger.error(f"Failed to initialize Firebase Admin SDK: {e}")

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
        logger.warning("FCM: Firebase Admin SDK not initialized, skipping notification")
        return False

    if not token:
        logger.warning("FCM: Empty token provided, skipping notification")
        return False

    # Подготовка данных для уведомления
    # Все значения в data должны быть строками для Firebase Admin SDK
    fcm_data = {}
    if data:
        for k, v in data.items():
            fcm_data[k] = str(v)
    
    if sender_id:
        fcm_data["sender_id"] = str(sender_id)
    
    if "type" not in fcm_data:
        fcm_data["type"] = "new_message"

    logger.debug(f"FCM: Preparing message for token {token[:15]}... | Data: {fcm_data}")

    # Создание объекта уведомления
    notification = messaging.Notification(
        title=title,
        body=body,
    )

    # Настройки для Android (каналы, группировка)
    # Используем group вместо tag, чтобы сообщения от одного пользователя 
    # не заменяли друг друга, а группировались (стакались) в шторке.
    group_key = f"user_msg_{sender_id}" if sender_id else "general_msg"
    android_config = messaging.AndroidConfig(
        priority='high',
        notification=messaging.AndroidNotification(
            group=group_key,
            channel_id="messages",
            sound="default",
            click_action="FLUTTER_NOTIFICATION_CLICK" # Для некоторых плагинов это важно
        )
    )

    # Настройки для iOS (APNS)
    apns_config = messaging.APNSConfig(
        payload=messaging.APNSPayload(
            aps=messaging.Aps(
                sound="default",
                thread_id=str(sender_id) if sender_id else None,
                content_available=True # Позволяет приложению проснуться в фоне
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
        # Отправка сообщения (выполняем в отдельном потоке, так как Admin SDK синхронный)
        loop = asyncio.get_event_loop()
        logger.info(f"FCM: Attempting to send message to {token[:15]}... Title: {title}")
        
        response = await loop.run_in_executor(None, lambda: messaging.send(message))
        
        logger.success(f"FCM: Successfully sent message. Response: {response}")
        return True
    except messaging.UnregisteredError:
        # Токен больше не валиден (приложение удалено или токен протух)
        logger.warning(f"FCM: Token is unregistered (invalid): {token[:15]}...")
        return False
    except messaging.QuotaExceededError:
        logger.error("FCM: Quota exceeded for project")
        return False
    except messaging.SenderIdMismatchError:
        logger.error("FCM: Sender ID mismatch")
        return False
    except messaging.ThirdPartyAuthError:
        logger.error("FCM: Third party authentication error (APNs issue?)")
        return False
    except Exception as e:
        logger.error(f"FCM: Request failed for token {token[:15]}... | Error: {type(e).__name__}: {e}")
        return False
