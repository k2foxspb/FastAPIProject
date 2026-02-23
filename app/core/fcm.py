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
            # 4. В поддиректории app (на случай запуска из корня)
            os.path.join(os.getcwd(), "app", FIREBASE_SERVICE_ACCOUNT_PATH),
        ]
        
        found_path = None
        for path in possible_paths:
            logger.debug(f"FCM: Checking path {path}")
            if os.path.exists(path):
                found_path = path
                break
        
        if found_path:
            logger.info(f"FCM: Initializing Firebase Admin SDK with service account from {found_path}")
            try:
                cred = credentials.Certificate(found_path)
                firebase_admin.initialize_app(cred)
                logger.success("FCM: Firebase Admin SDK initialized successfully")
            except Exception as init_err:
                logger.error(f"FCM: Error initializing with certificate {found_path}: {init_err}")
                # Если файл поврежден или не подходит, пытаемся инициализировать по умолчанию (из ENV)
                firebase_admin.initialize_app()
                logger.info("FCM: Initialized with default application credentials (ENV)")
        else:
            logger.warning(f"FCM: Firebase service account file '{FIREBASE_SERVICE_ACCOUNT_PATH}' NOT found. Trying default init.")
            try:
                firebase_admin.initialize_app()
                logger.success("FCM: Firebase Admin SDK initialized via default credentials (ENV)")
            except Exception as env_err:
                logger.error(f"FCM: Failed default initialization: {env_err}")
                logger.warning(f"FCM: Firebase service account file '{FIREBASE_SERVICE_ACCOUNT_PATH}' NOT found in any of these locations: {possible_paths}. FCM notifications will be disabled.")
    else:
        logger.info("FCM: Firebase Admin SDK already initialized")
except Exception as e:
    logger.exception(f"FCM: Critical error during Firebase Admin SDK module loading: {e}")

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
        
        # Добавляем дополнительные данные для клиента (Android data-only)
        if title:
            fcm_data["sender_name"] = str(title)
        if body:
            fcm_data["text"] = str(body)
        
        if "type" not in fcm_data:
            fcm_data["type"] = "new_message"

        logger.debug(f"FCM: Preparing message for token {token} | Data: {fcm_data}")

        # Настройки для Android (data-only): высокая приоритетность, без видимого Notification
        android_config = messaging.AndroidConfig(
            priority='high',
            ttl=3600 * 24, # 24 часа
        )

        # Настройки для iOS (APNS) с видимым алертом
        apns_config = messaging.APNSConfig(
            headers={
                "apns-priority": "10", # Немедленная доставка
            },
            payload=messaging.APNSPayload(
                aps=messaging.Aps(
                    alert=messaging.ApsAlert(title=title, body=body),
                    sound="default",
                    thread_id=str(sender_id) if sender_id else None,
                    content_available=True, # Позволяет приложению проснуться в фоне
                    mutable_content=True,
                    category="NEW_MESSAGE",
                    badge=1 # Показываем бейдж на иконке
                )
            )
        )

        # Создание сообщения: без поля notification (Android получит data-only)
        message = messaging.Message(
            data=fcm_data,
            token=token,
            android=android_config,
            apns=apns_config
        )

        # Отправка сообщения (выполняем в отдельном потоке, так как Admin SDK синхронный)
        loop = asyncio.get_event_loop()
        logger.info(f"FCM: Attempting to send message to {token[:20]}... Title: {title}")
        
        try:
            response = await loop.run_in_executor(None, lambda: messaging.send(message))
            logger.success(f"FCM: Successfully sent message to {token[:20]}... Response: {response}")
            return True
        except Exception as e:
            logger.error(f"FCM: Internal error during messaging.send: {e}")
            raise e
    except (messaging.UnregisteredError, exceptions.NotFoundError):
        # Токен больше не валиден (приложение удалено или токен протух)
        logger.warning(f"FCM: Token is unregistered (invalid): {token}")
        return False
    except exceptions.InvalidArgumentError as e:
        # Токен имеет неверный формат или другие аргументы неверны
        logger.warning(f"FCM: Invalid arguments (bad token format?): {e} | Token: {token}")
        return False
    except exceptions.FirebaseError as e:
        # Общая ошибка Firebase SDK
        logger.error(f"FCM: Firebase error for token {token[:20]}...: {e}")
        return False
    except Exception as e:
        logger.error(f"FCM: Request failed for token {token[:20]}... | Error: {type(e).__name__}: {e}")
        return False
