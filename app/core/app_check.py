import firebase_admin
import os
from firebase_admin import app_check, credentials
from fastapi import Request, HTTPException, status
from loguru import logger
from app.core import config

async def verify_app_check(request: Request):
    """
    Зависимость для верификации токена Firebase App Check.
    Проверяет наличие заголовка 'X-Firebase-AppCheck' и его валидность.
    """
    if not config.FIREBASE_APP_CHECK_ENFORCED:
        return None

    app_check_token = request.headers.get("X-Firebase-AppCheck")
    if not app_check_token:
        # Мы логируем это как предупреждение, если проверка принудительная
        logger.warning(f"App Check: Missing token in request to {request.url.path}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Firebase App Check token",
        )

    try:
        # Убеждаемся, что firebase_admin инициализирован
        if not firebase_admin._apps:
             logger.info("App Check: Firebase Admin not initialized, attempting initialization with service account")
             try:
                 # Ищем файл так же, как в fcm.py
                 possible_paths = [
                     os.path.abspath(config.FIREBASE_SERVICE_ACCOUNT_PATH),
                     os.path.join(os.getcwd(), config.FIREBASE_SERVICE_ACCOUNT_PATH),
                     os.path.join(os.getcwd(), "app", config.FIREBASE_SERVICE_ACCOUNT_PATH),
                 ]
                 
                 found_path = None
                 for path in possible_paths:
                     if os.path.exists(path):
                         found_path = path
                         break
                 
                 if found_path:
                     cred = credentials.Certificate(found_path)
                     firebase_admin.initialize_app(cred)
                     logger.success(f"App Check: Initialized with {found_path}")
                 else:
                     firebase_admin.initialize_app()
                     logger.info("App Check: Initialized with default credentials")
             except Exception as init_err:
                 logger.error(f"App Check: Failed to initialize Firebase Admin: {init_err}")
        
        # Верификация токена
        try:
            decoded_token = app_check.verify_token(app_check_token)
            return decoded_token
        except Exception as verify_err:
            logger.error(f"App Check: Verification failed for {request.url.path}. Error: {verify_err}")
            # Пытаемся достать больше деталей если это возможно
            raise verify_err

    except Exception as e:
        # Если это уже HTTPException, пробрасываем
        if isinstance(e, HTTPException):
            raise e
            
        logger.error(f"App Check: Uncaught error for {request.url.path}: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Firebase App Check token: {str(e)}",
        )
