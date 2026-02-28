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

    # Если указан базовый deeplink приложения — добавим его как redirect-параметр
    if MOBILE_DEEPLINK:
        encoded_redirect = quote(MOBILE_DEEPLINK, safe=":/?&=#")
        verification_url += f"&redirect={encoded_redirect}"

    subject = f"Подтверждение регистрации в {MAIL_FROM_NAME}"
    
    text = f"""Здравствуйте!

Рады, что вы с нами. Для завершения регистрации в {MAIL_FROM_NAME}, пожалуйста, подтвердите ваш адрес:

{verification_url}

Если у вас установлено наше приложение, можно перейти сразу по этой ссылке:
{MOBILE_DEEPLINK}?token={token}

Если вы не регистрировались, просто проигнорируйте это сообщение.

С уважением,
Команда {MAIL_FROM_NAME}
"""
    
    html = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.5; color: #000;">
        <div style="max-width: 500px; margin: 0; padding: 10px;">
          <p>Здравствуйте!</p>
          <p>Благодарим за регистрацию в <b>{MAIL_FROM_NAME}</b>. Для активации аккаунта, пожалуйста, нажмите на кнопку ниже:</p>
          
          <div style="margin: 20px 0;">
            <a href="{verification_url}" 
               style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
               Подтвердить Email
            </a>
          </div>
          
          <p style="font-size: 14px; color: #555;">
            Или скопируйте ссылку в браузер: {verification_url}
          </p>
          
          <p style="font-size: 14px; color: #555;">
            Для открытия в мобильном приложении: <a href="{MOBILE_DEEPLINK}?token={token}">{MOBILE_DEEPLINK}?token={token}</a>
          </p>
          
          <hr style="border: 0; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="font-size: 12px; color: #999;">
            Если вы не совершали данное действие, просто проигнорируйте это письмо.
          </p>
        </div>
      </body>
    </html>
    """
    await send_email(email, subject, text, html)

async def send_welcome_email(email: str):
    logger.info(f"Sending welcome email to {email}")
    subject = f"Добро пожаловать в {MAIL_FROM_NAME}"
    
    text = f"""Здравствуйте!

Мы рады приветствовать вас в {MAIL_FROM_NAME}.

В ближайшее время вам придет второе письмо со ссылкой для подтверждения вашего адреса электронной почты. Это необходимо для активации всех функций аккаунта.

С уважением,
Команда {MAIL_FROM_NAME}
"""
    
    html = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.5; color: #000;">
        <div style="max-width: 500px; margin: 0; padding: 10px;">
          <p>Здравствуйте!</p>
          <p>Мы рады, что вы присоединились к <b>{MAIL_FROM_NAME}</b>.</p>
          <p>Письмо с подтверждением аккаунта будет отправлено вам следующим сообщением. Пожалуйста, проверьте почту через минуту.</p>
          
          <p>С уважением,<br>Команда {MAIL_FROM_NAME}</p>
        </div>
      </body>
    </html>
    """
    await send_email(email, subject, text, html)

async def send_welcome_and_verification_email(email: str, token: str):
    """Отправляет приветствие, а затем письмо верификации с паузой."""
    await send_welcome_email(email)
    import asyncio
    await asyncio.sleep(5)
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
    message["X-Mailer"] = "Python SmtpLib"
    
    # Message-ID
    msg_id_domain = 'mail.ru'
    if MAIL_FROM and '@' in MAIL_FROM:
        msg_id_domain = MAIL_FROM.split('@')[-1]
    elif MAIL_USERNAME and '@' in MAIL_USERNAME:
        msg_id_domain = MAIL_USERNAME.split('@')[-1]
    
    message["Message-ID"] = make_msgid(domain=msg_id_domain)
    message["Date"] = formatdate(localtime=True)
    
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
                server.sendmail(MAIL_FROM or MAIL_USERNAME, email, message.as_string())
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
                server.sendmail(MAIL_FROM or MAIL_USERNAME, email, message.as_string())
            finally:
                server.quit()
        logger.success(f"Email successfully sent to {email}")
    except Exception as e:
        logger.error(f"CRITICAL: Failed to send email to {email}: {e}")
        # Не поднимаем исключение выше, если это BackgroundTask, 
        # но для Celery это полезно для ретраев. 
        # Однако в текущей реализации мы ловим ошибку в Celery таске.
        raise e
