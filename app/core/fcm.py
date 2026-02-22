import firebase_admin
import asyncio
from loguru import logger
from firebase_admin import credentials, messaging, exceptions
from typing import Optional
import os
from app.core.config import FIREBASE_SERVICE_ACCOUNT_PATH

# Инициализация Firebase Admin SDK
# Мы инициализируем его один раз при импорте модуля
logger.info("FCM: Module loaded, checking Firebase initialization...")

try:
    if not firebase_admin._apps:
        # Пытаемся найти файл по нескольким возможным путям
        possible_paths = [
            # 1. По абсолютному пути из конфига
            os.path.abspath(FIREBASE_SERVICE_ACCOUNT_PATH),
            # 2. В корне проекта (на уровень выше пакета app)
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), FIREBASE_SERVICE_ACCOUNT_PATH),
            # 3. В текущей директории
            os.path.join(os.getcwd(), FIREBASE_SERVICE_ACCOUNT_PATH),
        ]
        
        found_path = None
        for path in possible_paths:
            logger.debug(f"FCM: Checking path {path}")
            if os.path.exists(path):
                found_path = path
                break
        
        if found_path:
            logger.info(f"FCM: Initializing Firebase Admin SDK with service account from {found_path}")
            cred = credentials.Certificate(found_path)
            firebase_admin.initialize_app(cred)
            logger.success("FCM: Firebase Admin SDK initialized successfully")
        else:
            logger.warning(f"FCM: Firebase service account file '{FIREBASE_SERVICE_ACCOUNT_PATH}' NOT found in any of these locations: {possible_paths}. FCM notifications will be disabled.")
    else:
        logger.info("FCM: Firebase Admin SDK already initialized")
except Exception as e:
    logger.error(f"FCM: Failed to initialize Firebase Admin SDK: {e}")

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

    try:
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
        android_config = messaging.AndroidConfig(
            priority='high',
            notification=messaging.AndroidNotification(
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

        # Отправка сообщения (выполняем в отдельном потоке, так как Admin SDK синхронный)
        loop = asyncio.get_event_loop()
        logger.info(f"FCM: Attempting to send message to {token[:15]}... Title: {title}")
        
        response = await loop.run_in_executor(None, lambda: messaging.send(message))
        
        logger.success(f"FCM: Successfully sent message. Response: {response}")
        return True
    except (messaging.UnregisteredError, exceptions.NotFoundError):
        # Токен больше не валиден (приложение удалено или токен протух)
        logger.warning(f"FCM: Token is unregistered (invalid): {token[:15]}...")
        return False
    except (messaging.InvalidArgumentError, exceptions.InvalidArgumentError) as e:
        # Токен имеет неверный формат или другие аргументы неверны
        logger.warning(f"FCM: Invalid arguments (bad token format?): {e}")
        return False
    except exceptions.FirebaseError as e:
        # Общая ошибка Firebase SDK
        logger.error(f"FCM: Firebase error for token {token[:15]}...: {e}")
        return False
    except Exception as e:
        logger.error(f"FCM: Request failed for token {token[:15]}... | Error: {type(e).__name__}: {e}")
        return False
