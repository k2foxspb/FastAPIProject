import firebase_admin
import asyncio
from loguru import logger
from firebase_admin import credentials, messaging, exceptions
from typing import Optional
import os
import time
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

async def invalidate_fcm_token(token: str):
    """
    Удаляет FCM токен из базы данных у всех пользователей, которым он принадлежит.
    Используется когда Firebase сообщает, что токен больше не валиден.
    """
    if not token:
        return

    try:
        from app.database import async_session_maker
        from app.models.users import User as UserModel
        from sqlalchemy import update
        
        async with async_session_maker() as session:
            # Сбрасываем fcm_token в null для всех пользователей с этим токеном
            stmt = update(UserModel).where(UserModel.fcm_token == token).values(fcm_token=None)
            result = await session.execute(stmt)
            await session.commit()
            
            if result.rowcount > 0:
                logger.info(f"FCM: Automatically invalidated and removed token {token[:15]}... from {result.rowcount} user(s)")
            else:
                logger.debug(f"FCM: Token {token[:15]}... not found in database for invalidation")
    except Exception as e:
        logger.error(f"FCM: Failed to invalidate token {token[:15]}... in database: {e}")

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
                if v is not None:
                    fcm_data[k] = str(v)
        
        if sender_id:
            fcm_data["sender_id"] = str(sender_id)
        
        # Добавляем поля для обработки на клиенте (особенно важно для Android data-only/custom)
        if title:
            fcm_data["notif_title"] = str(title)
            if "sender_name" not in fcm_data:
                fcm_data["sender_name"] = str(title)
        
        if body:
            fcm_data["notif_body"] = str(body)
            if "text" not in fcm_data:
                fcm_data["text"] = str(body)
        
        # Указываем ID канала (соответствует каналу "Сообщения" в приложении)
        if "android_channel_id" not in fcm_data:
            fcm_data["android_channel_id"] = "messages"
        
        if "type" not in fcm_data:
            fcm_data["type"] = "new_message"

        logger.debug(f"FCM: Preparing message. Token: {token[:15]}... | Data: {fcm_data}")

        # Настройки для Android: высокая приоритетность для пробуждения (Headless JS).
        # Мы возвращаем секцию 'notification' для Android, чтобы гарантировать пробуждение
        # из Doze mode. Однако мы настраиваем Config Plugin, чтобы Expo-notifications
        # мог перехватывать и кастомизировать это уведомление.
        
        android_config = messaging.AndroidConfig(
            priority='high',
            ttl=3600 * 24,  # 24 часа
            direct_boot_ok=True,
            notification=messaging.AndroidNotification(
                title=title,
                body=body,
                channel_id=fcm_data.get("android_channel_id", "messages"),
                tag=fcm_data.get("notif_tag"),
                priority='high',
                default_sound=True,
                default_vibrate_timings=True,
            )
        )

        # Настройки для iOS (APNS)
        apns_config = messaging.APNSConfig(
            headers={
                "apns-priority": "10",
                "apns-expiration": str(int(time.time() + 3600 * 24))
            },
            payload=messaging.APNSPayload(
                aps=messaging.Aps(
                    alert=messaging.ApsAlert(title=title, body=body),
                    sound="default",
                    thread_id=str(sender_id) if sender_id else (fcm_data.get("chat_id") or fcm_data.get("news_id")),
                    content_available=True,
                    mutable_content=True,
                    category="message_actions" if fcm_data.get("type") == "new_message" else None,
                    badge=1
                )
            )
        )

        # Сборка сообщения.
        # Комбинация Notification + Data гарантирует доставку и пробуждение.
        message = messaging.Message(
            data=fcm_data,
            token=token,
            android=android_config,
            apns=apns_config
        )

        # Отправка сообщения
        try:
            # Получаем текущий цикл событий или создаем новый для run_in_executor
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = asyncio.get_event_loop()
                
            logger.info(f"FCM: Sending to {token[:15]}... Title: '{title}' (Notification + Data)")
            # Используем run_in_executor, так как Firebase Admin SDK блокирующий (синхронный)
            start_time = time.time()
            response = await loop.run_in_executor(None, lambda: messaging.send(message))
            duration = (time.time() - start_time) * 1000
            logger.success(f"FCM: Sent successfully to {token[:15]}... in {duration:.1f}ms. Response: {response}")
            return True
        except (messaging.UnregisteredError, exceptions.NotFoundError) as e:
            # Токен больше не валиден (приложение удалено или токен протух)
            logger.warning(f"FCM: Token is unregistered (invalid): {e} | Token: {token}")
            # Автоматически удаляем невалидный токен из базы данных
            asyncio.create_task(invalidate_fcm_token(token))
            return False
        except exceptions.InvalidArgumentError as e:
            # Токен имеет неверный формат или другие аргументы неверны
            logger.warning(f"FCM: Invalid arguments (bad token format?): {e} | Token: {token}")
            # Если токен имеет неверный формат, его тоже стоит удалить
            asyncio.create_task(invalidate_fcm_token(token))
            return False
        except exceptions.FirebaseError as e:
            # Общая ошибка Firebase SDK
            logger.error(f"FCM: Firebase error for token {token[:20]}...: {e}")
            return False
        except Exception as e:
            logger.error(f"FCM: Internal error during messaging.send: {e}")
            return False
    except Exception as e:
        logger.error(f"FCM: Request failed for token {token[:20]}... | Error: {type(e).__name__}: {e}")
        return False
