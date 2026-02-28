import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import make_msgid, formatdate, formataddr
from app.core.config import (
    MAIL_USERNAME, MAIL_PASSWORD, MAIL_FROM, 
    MAIL_PORT, MAIL_SERVER, MAIL_FROM_NAME, DOMAIN, MOBILE_DEEPLINK
)
from loguru import logger
from urllib.parse import quote

async def send_verification_email(email: str, token: str):
    logger.info(f"Sending verification email to {email}")
    verification_url = f"{DOMAIN}/verify-email?token={token}"

    subject = "Код подтверждения"
    
    text = f"""Привет!

Пожалуйста, подтверди свой адрес, перейдя по ссылке:
{verification_url}

Это нужно, чтобы убедиться, что адрес принадлежит тебе.

Если ты не регистрировался, просто удали это письмо.

Команда {MAIL_FROM_NAME}
"""
    
    # Временно убираем HTML полностью
    await send_email(email, subject, text, None)

async def send_welcome_email(email: str):
    logger.info(f"Sending welcome email to {email}")
    subject = "Привет!"
    
    text = f"""Привет!

Рады, что ты с нами. Через несколько минут тебе придет ссылка для подтверждения адреса.

Это письмо не требует ответа.

Команда {MAIL_FROM_NAME}
"""
    # Для приветственного письма используем только текст
    await send_email(email, subject, text, None)

async def send_welcome_and_verification_email(email: str, token: str):
    """Отправляет приветствие, а затем письмо верификации с паузой."""
    await send_welcome_email(email)
    import asyncio
    await asyncio.sleep(10)
    await send_verification_email(email, token)

async def send_email(email: str, subject: str, text: str, html: str | None = None):
    logger.info(f"Preparing to send email to {email} (Subject: {subject})")
    
    if not MAIL_SERVER or not MAIL_USERNAME:
        logger.error(f"SMTP settings missing! SERVER: {MAIL_SERVER}, USER: {MAIL_USERNAME}")
        return

    # Маскировка пароля для логов
    pwd_status = "set" if MAIL_PASSWORD else "NOT SET"
    logger.debug(f"SMTP Config: SERVER={MAIL_SERVER}, PORT={MAIL_PORT}, USER={MAIL_USERNAME}, FROM={MAIL_FROM}, PWD={pwd_status}")

    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = formataddr((MAIL_FROM_NAME, MAIL_FROM or MAIL_USERNAME))
    message["To"] = email
    message["Reply-To"] = MAIL_FROM or MAIL_USERNAME
    
    # Message-ID и другие служебные заголовки
    msg_id_domain = 'fokin.fun'
    # Пытаемся извлечь домен из MAIL_USERNAME или MAIL_FROM
    if MAIL_USERNAME and '@' in MAIL_USERNAME:
        msg_id_domain = MAIL_USERNAME.split('@')[-1]
    elif MAIL_FROM and '@' in MAIL_FROM:
        msg_id_domain = MAIL_FROM.split('@')[-1]
    elif DOMAIN:
        from urllib.parse import urlparse
        parsed = urlparse(DOMAIN)
        if parsed.netloc:
            msg_id_domain = parsed.netloc
    
    message["Message-ID"] = make_msgid(domain=msg_id_domain)
    message["Date"] = formatdate(localtime=True)
    message["Auto-Submitted"] = "auto-generated"
    
    part1 = MIMEText(text, "plain", "utf-8")
    message.attach(part1)
    
    if html:
        part2 = MIMEText(html, "html", "utf-8")
        message.attach(part2)

    try:
        # Используем SMTP_SSL для порта 465 (Mail.ru)
        if MAIL_PORT == 465:
            logger.info(f"Connecting to {MAIL_SERVER}:{MAIL_PORT} using SSL...")
            server = smtplib.SMTP_SSL(MAIL_SERVER, MAIL_PORT, timeout=20)
            try:
                if MAIL_PASSWORD:
                    server.login(MAIL_USERNAME, MAIL_PASSWORD)
                    logger.debug("SMTP login successful")
                server.send_message(message)
            finally:
                server.quit()
        else:
            # Для порта 587 или других используем STARTTLS
            logger.info(f"Connecting to {MAIL_SERVER}:{MAIL_PORT} using STARTTLS...")
            server = smtplib.SMTP(MAIL_SERVER, MAIL_PORT, timeout=20)
            try:
                server.starttls()
                if MAIL_PASSWORD:
                    server.login(MAIL_USERNAME, MAIL_PASSWORD)
                    logger.debug("SMTP login successful")
                server.send_message(message)
            finally:
                server.quit()
        logger.success(f"Email successfully sent to {email}")
    except Exception as e:
        logger.error(f"CRITICAL: Failed to send email to {email}: {e}")
        # Не поднимаем исключение выше, если это BackgroundTask, 
        # но для Celery это полезно для ретраев. 
        # Однако в текущей реализации мы ловим ошибку в Celery таске.
        raise e
