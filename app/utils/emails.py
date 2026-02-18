import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import make_msgid, formatdate
from app.core.config import (
    MAIL_USERNAME, MAIL_PASSWORD, MAIL_FROM, 
    MAIL_PORT, MAIL_SERVER, MAIL_FROM_NAME, DOMAIN, MOBILE_DEEPLINK
)
from loguru import logger
from urllib.parse import quote

async def send_verification_email(email: str, token: str):
    logger.info(f"Sending verification email to {email}")
    verification_url = f"{DOMAIN}/users/verify-email?token={token}"

    # Если указан базовый deeplink приложения — добавим его как redirect-параметр
    if MOBILE_DEEPLINK:
        encoded_redirect = quote(MOBILE_DEEPLINK, safe=":/?&=#")
        verification_url += f"&redirect={encoded_redirect}"

    subject = "Код подтверждения"
    
    text = f"""Здравствуйте!

Для завершения регистрации, пожалуйста, перейдите по ссылке:
{verification_url}

Если вы не запрашивали это письмо, просто проигнорируйте его."""
    
    html = f"""
    <html>
      <body>
        <p>Для подтверждения регистрации перейдите по ссылке:</p>
        <p><a href="{verification_url}">{verification_url}</a></p>
      </body>
    </html>
    """
    await send_email(email, subject, text, html)

async def send_email(email: str, subject: str, text: str, html: str | None = None):
    logger.info(f"Sending email to {email} with subject: {subject}")
    
    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = MAIL_FROM
    message["To"] = email
    
    # Генерация Message-ID. Важно использовать домен отправителя, а не localhost
    msg_id_domain = 'mail.ru'
    if MAIL_FROM and '@' in MAIL_FROM:
        msg_id_domain = MAIL_FROM.split('@')[-1]
    
    message["Message-ID"] = make_msgid(domain=msg_id_domain)
    message["Date"] = formatdate(localtime=True)
    
    part1 = MIMEText(text, "plain", "utf-8")
    message.attach(part1)
    
    if html:
        part2 = MIMEText(html, "html", "utf-8")
        message.attach(part2)

    if not MAIL_SERVER:
        logger.warning(f"MAIL_SERVER не настроен. Email to {email}: {subject}")
        return

    try:
        # Используем SMTP_SSL для порта 465 (Mail.ru)
        if MAIL_PORT == 465:
            logger.info(f"Connecting to {MAIL_SERVER}:{MAIL_PORT} using SSL")
            server = smtplib.SMTP_SSL(MAIL_SERVER, MAIL_PORT, timeout=20)
            try:
                if MAIL_PASSWORD:
                    server.login(MAIL_USERNAME, MAIL_PASSWORD)
                server.sendmail(MAIL_FROM, email, message.as_string())
            finally:
                server.quit()
        else:
            # Для порта 587 используем STARTTLS
            logger.info(f"Connecting to {MAIL_SERVER}:{MAIL_PORT} using STARTTLS")
            server = smtplib.SMTP(MAIL_SERVER, MAIL_PORT, timeout=20)
            try:
                if MAIL_PASSWORD:
                    server.starttls()
                    server.login(MAIL_USERNAME, MAIL_PASSWORD)
                server.sendmail(MAIL_FROM, email, message.as_string())
            finally:
                server.quit()
        logger.info(f"Email successfully sent to {email}")
    except Exception as e:
        logger.error(f"Ошибка при отправке почты на {email}: {e}")
        raise e
