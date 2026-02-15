import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.core.config import (
    MAIL_USERNAME, MAIL_PASSWORD, MAIL_FROM, 
    MAIL_PORT, MAIL_SERVER, MAIL_FROM_NAME, DOMAIN
)
from loguru import logger

async def send_verification_email(email: str, token: str):
    logger.info(f"Sending verification email to {email}")
    verification_url = f"{DOMAIN}/api/users/verify-email?token={token}"
    
    message = MIMEMultipart("alternative")
    message["Subject"] = f"Подтверждение регистрации на {MAIL_FROM_NAME}"
    message["From"] = f"{MAIL_FROM_NAME} <{MAIL_FROM}>"
    message["To"] = email
    message["List-Unsubscribe"] = f"<{DOMAIN}/unsubscribe>" # Good practice

    text = f"""Здравствуйте!

Благодарим вас за регистрацию в {MAIL_FROM_NAME}.
Чтобы завершить создание учетной записи и подтвердить ваш адрес электронной почты, пожалуйста, перейдите по следующей ссылке:

{verification_url}

Если вы не регистрировались на нашем сайте, просто проигнорируйте это письмо.

С уважением,
Команда {MAIL_FROM_NAME}
"""
    html = f"""
    <html>
      <head>
        <style>
          .button {{
            background-color: #4CAF50;
            border: none;
            color: white;
            padding: 15px 32px;
            text-align: center;
            text-decoration: none;
            display: inline-block;
            font-size: 16px;
            margin: 4px 2px;
            cursor: pointer;
            border-radius: 8px;
          }}
        </style>
      </head>
      <body>
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #333;">Подтверждение регистрации</h2>
          <p>Здравствуйте!</p>
          <p>Благодарим вас за регистрацию в <strong>{MAIL_FROM_NAME}</strong>.</p>
          <p>Для завершения регистрации, пожалуйста, подтвердите ваш адрес электронной почты, нажав на кнопку ниже:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="{verification_url}" class="button" style="color: white;">Подтвердить почту</a>
          </div>
          <p style="font-size: 12px; color: #777;">Если кнопка не работает, скопируйте и вставьте следующую ссылку в адресную строку браузера:<br>
          <a href="{verification_url}">{verification_url}</a></p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 12px; color: #999;">Вы получили это письмо, потому что этот адрес был указан при регистрации в {MAIL_FROM_NAME}. Если это были не вы, просто проигнорируйте это сообщение.</p>
        </div>
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
        # Используем SMTP_SSL для порта 465 (Mail.ru)
        if MAIL_PORT == 465:
            logger.info(f"Connecting to {MAIL_SERVER}:{MAIL_PORT} using SSL")
            with smtplib.SMTP_SSL(MAIL_SERVER, MAIL_PORT) as server:
                if MAIL_PASSWORD:
                    server.login(MAIL_USERNAME, MAIL_PASSWORD)
                server.sendmail(MAIL_FROM, email, message.as_string())
        else:
            # Для порта 587 используем STARTTLS
            logger.info(f"Connecting to {MAIL_SERVER}:{MAIL_PORT} using STARTTLS")
            with smtplib.SMTP(MAIL_SERVER, MAIL_PORT) as server:
                if MAIL_PASSWORD:
                    server.starttls()
                    server.login(MAIL_USERNAME, MAIL_PASSWORD)
                server.sendmail(MAIL_FROM, email, message.as_string())
        logger.info(f"Email successfully sent to {email}")
    except Exception as e:
        logger.error(f"Ошибка при отправке почты на {email}: {e}")
        # Пробрасываем ошибку дальше, чтобы FastAPI мог её обработать или логировать
        raise e
