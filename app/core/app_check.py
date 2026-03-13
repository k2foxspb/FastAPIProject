import firebase_admin
import os
import httpx
from firebase_admin import app_check, credentials
from fastapi import Request, HTTPException, status
from loguru import logger
from app.core import config

async def verify_recaptcha(token: str | None):
    """
    Верифицирует токен Google reCAPTCHA Enterprise.
    Если RECAPTCHA_API_KEY не задан, пропускает проверку (для разработки).
    """
    if not token:
        logger.warning("reCAPTCHA: Token is missing")
        return False

    if not config.RECAPTCHA_API_KEY:
        logger.info("reCAPTCHA: API Key not set, skipping verification (Development mode)")
        return True

    project_id = config.RECAPTCHA_PROJECT_ID
    site_key = config.RECAPTCHA_SITE_KEY
    api_key = config.RECAPTCHA_API_KEY

    url = f"https://recaptchaenterprise.googleapis.com/v1/projects/{project_id}/assessments?key={api_key}"
    
    payload = {
        "event": {
            "token": token,
            "siteKey": site_key,
            "expectedAction": "LOGIN"
        }
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()

            # Проверяем валидность токена
            if not data.get("tokenProperties", {}).get("valid"):
                invalid_reason = data.get("tokenProperties", {}).get("invalidReason")
                logger.warning(f"reCAPTCHA: Invalid token. Reason: {invalid_reason}")
                return False

            # Проверяем оценку риска (score)
            # score от 0.0 (бот) до 1.0 (человек). Обычно 0.5 - порог.
            risk_analysis = data.get("riskAnalysis", {})
            score = risk_analysis.get("score", 0)
            logger.info(f"reCAPTCHA: Token verified. Score: {score}")

            if score < 0.5:
                logger.warning(f"reCAPTCHA: Low score ({score}). Possible bot activity.")
                return False

            return True

    except Exception as e:
        logger.error(f"reCAPTCHA: Error during verification: {e}")
        # В случае ошибки API Google, мы можем либо разрешить вход, либо запретить.
        # Обычно лучше разрешить, чтобы не блокировать пользователей при сбоях сервиса.
        return True

async def verify_app_check(request: Request):
    """
    Зависимость для верификации токена Firebase App Check.
    Проверяет наличие заголовка 'X-Firebase-AppCheck' и его валидность.
    """
    # Мы логируем вход в функцию, чтобы пользователь видел, что она вызывается
    logger.info(f"App Check: Checking request to {request.url.path}")

    if not config.FIREBASE_APP_CHECK_ENFORCED:
        app_check_token = request.headers.get("X-Firebase-AppCheck")
        if app_check_token:
             logger.info(f"App Check: Token found in header, but enforcement is OFF (FIREBASE_APP_CHECK_ENFORCED=false)")
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
            # Получаем ID проекта для логов
            project_id = "unknown"
            if firebase_admin._apps:
                app = list(firebase_admin._apps.values())[0]
                project_id = getattr(app, 'project_id', 'unknown')
            
            # Логируем часть токена для диагностики
            token_hint = f"{app_check_token[:10]}...{app_check_token[-10:]}" if len(app_check_token) > 20 else "short_token"
            
            logger.error(f"App Check: Verification failed for {request.url.path}. Project: {project_id}. Token: {token_hint}. Error: {verify_err}")
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
