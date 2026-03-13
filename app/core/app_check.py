import firebase_admin
from firebase_admin import app_check
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
             # Если по какой-то причине не инициализирован (хотя должен быть через fcm.py),
             # пробуем инициализацию по умолчанию.
             logger.info("App Check: Firebase Admin not initialized, attempting default initialization")
             try:
                 firebase_admin.initialize_app()
             except Exception as init_err:
                 logger.error(f"App Check: Failed to initialize Firebase Admin: {init_err}")
        
        # Верификация токена
        decoded_token = app_check.verify_token(app_check_token)
        return decoded_token
    except Exception as e:
        logger.error(f"App Check: Verification failed for {request.url.path}: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Firebase App Check token",
        )
