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
    # Используем путь /verify-email (без /users/), чтобы он соответствовал intent filter в app.json
    verification_url = f"{DOMAIN}/verify-email?token={token}"

    subject = "Регистрация"
    
    text = f"""Здравствуйте!

Благодарим за регистрацию в {MAIL_FROM_NAME}.

Для завершения регистрации, пожалуйста, подтвердите ваш адрес:
{verification_url}

Если вы не регистрировались, просто проигнорируйте это сообщение.

Это письмо отправлено автоматически, на него не нужно отвечать.

С уважением,
Команда {MAIL_FROM_NAME}
"""
    
    html = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #000;">
        <p>Здравствуйте!</p>
        <p>Для завершения регистрации, пожалуйста, перейдите по ссылке:</p>
        <p><a href="{verification_url}">{verification_url}</a></p>
        <p>Если ссылка не открывается, скопируйте её в адресную строку браузера.</p>
        <br>
        <p style="font-size: 12px; color: #666;">Это письмо отправлено автоматически, на него не нужно отвечать.</p>
        <p>С уважением,<br>Команда {MAIL_FROM_NAME}</p>
      </body>
    </html>
    """
    await send_email(email, subject, text, html)

async def send_welcome_email(email: str):
    logger.info(f"Sending welcome email to {email}")
    subject = "Добро пожаловать"
    
    text = f"""Здравствуйте!

Мы рады приветствовать вас в нашем проекте.

В ближайшее время вам придет ссылка для подтверждения вашего адреса.

Это письмо отправлено автоматически, на него не нужно отвечать.

С уважением,
Команда {MAIL_FROM_NAME}
"""
    # Для приветственного письма используем только текст (меньше шансов попасть в спам)
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
    if DOMAIN:
        # Пытаемся извлечь домен из DOMAIN
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
