import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.core.config import (
    MAIL_USERNAME, MAIL_PASSWORD, MAIL_FROM, 
    MAIL_PORT, MAIL_SERVER, MAIL_FROM_NAME, DOMAIN
)
import logging

logger = logging.getLogger(__name__)

async def send_verification_email(email: str, token: str):
    verification_url = f"{DOMAIN}/api/users/verify-email?token={token}"
    
    message = MIMEMultipart("alternative")
    message["Subject"] = "Подтверждение регистрации"
    message["From"] = f"{MAIL_FROM_NAME} <{MAIL_FROM}>"
    message["To"] = email

    text = f"Пожалуйста, подтвердите вашу регистрацию, перейдя по ссылке: {verification_url}"
    html = f"""
    <html>
      <body>
        <p>Привет!<br>
           Пожалуйста, подтвердите вашу регистрацию, перейдя по ссылке ниже:<br>
           <a href="{verification_url}">Подтвердить регистрацию</a>
        </p>
      </body>
    </html>
    """

    part1 = MIMEText(text, "plain")
    part2 = MIMEText(html, "html")
    message.attach(part1)
    message.attach(part2)

    if not MAIL_SERVER:
        logger.warning(f"MAIL_SERVER не настроен. Ссылка для подтверждения ({email}): {verification_url}")
        print(f"DEBUG: Ссылка для подтверждения ({email}): {verification_url}")
        return

    try:
        # Для простоты используем синхронную отправку, в идеале это должно быть в Celery
        with smtplib.SMTP(MAIL_SERVER, MAIL_PORT) as server:
            if MAIL_PASSWORD:
                server.starttls()
                server.login(MAIL_USERNAME, MAIL_PASSWORD)
            server.sendmail(MAIL_FROM, email, message.as_string())
    except Exception as e:
        logger.error(f"Ошибка при отправке почты: {e}")
        print(f"DEBUG Error sending email: {e}")
        # Не бросаем исключение, чтобы не прерывать регистрацию, 
        # но в логах будет информация. В проде лучше бросать или логировать серьезно.
