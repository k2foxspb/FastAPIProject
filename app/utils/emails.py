import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import make_msgid, formatdate
from app.core.config import (
    MAIL_USERNAME, MAIL_PASSWORD, MAIL_FROM, 
    MAIL_PORT, MAIL_SERVER, MAIL_FROM_NAME, DOMAIN
)
from loguru import logger

async def send_verification_email(email: str, token: str):
    logger.info(f"Sending verification email to {email}")
    verification_url = f"{DOMAIN}/api/users/verify-email?token={token}"
    subject = f"Подтверждение регистрации — {MAIL_FROM_NAME}"
    
    text = f"""Здравствуйте!

Добро пожаловать в {MAIL_FROM_NAME}!

Мы рады, что вы присоединились к нашему сообществу. Чтобы начать пользоваться всеми возможностями вашего аккаунта, нам нужно подтвердить, что этот адрес электронной почты принадлежит именно вам.

Пожалуйста, подтвердите вашу почту, перейдя по ссылке:
{verification_url}

Если вы не регистрировались в нашей системе, просто проигнорируйте это письмо. Оно было отправлено автоматически.

С уважением,
Команда {MAIL_FROM_NAME}
{DOMAIN}
"""
    html = f"""
    <html>
      <body style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f9f9f9; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #eef2f5;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1a73e8; margin: 0; font-size: 28px;">{MAIL_FROM_NAME}</h1>
          </div>
          
          <h2 style="color: #2c3e50; margin-top: 0; font-weight: 600;">Подтверждение регистрации</h2>
          <p style="font-size: 16px;">Здравствуйте!</p>
          <p style="font-size: 16px;">Благодарим вас за проявленный интерес и регистрацию в проекте <strong>{MAIL_FROM_NAME}</strong>.</p>
          <p style="font-size: 16px;">Для активации вашего профиля и обеспечения безопасности аккаунта, пожалуйста, подтвердите ваш адрес электронной почты:</p>
          
          <div style="text-align: center; margin: 35px 0;">
            <a href="{verification_url}" style="background-color: #1a73e8; color: #ffffff; padding: 16px 32px; text-decoration: none; font-size: 16px; font-weight: bold; border-radius: 6px; display: inline-block; transition: background-color 0.3s;">
              Активировать аккаунт
            </a>
          </div>
          
          <p style="font-size: 14px; color: #5f6368;">Если кнопка выше не работает, скопируйте эту ссылку в браузер:</p>
          <p style="font-size: 13px; word-break: break-all; color: #1a73e8;">
            <a href="{verification_url}" style="color: #1a73e8;">{verification_url}</a>
          </p>
          
          <hr style="border: none; border-top: 1px solid #edf2f7; margin: 30px 0;">
          
          <p style="font-size: 12px; color: #70757a; text-align: center;">
            Вы получили это письмо, так как этот адрес был указан при регистрации на сайте {DOMAIN}.<br>
            Если это были не вы, просто удалите это сообщение.
          </p>
          <p style="font-size: 12px; color: #b0b8bf; text-align: center; margin-top: 15px;">
            © 2026 {MAIL_FROM_NAME}. Все права защищены.
          </p>
        </div>
      </body>
    </html>
    """
    await send_email(email, subject, text, html)

async def send_email(email: str, subject: str, text: str, html: str | None = None):
    logger.info(f"Sending email to {email} with subject: {subject}")
    
    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = f"{MAIL_FROM_NAME} <{MAIL_FROM}>"
    message["To"] = email
    
    # Генерация Message-ID
    msg_id_domain = 'localhost'
    if MAIL_SERVER and '.' in MAIL_SERVER:
        parts = MAIL_SERVER.split('.')
        if len(parts) >= 2:
            msg_id_domain = '.'.join(parts[-2:])
    
    message["Message-ID"] = make_msgid(domain=msg_id_domain)
    message["Date"] = formatdate(localtime=True)
    message["X-Priority"] = "3"  # Normal
    message["X-Mailer"] = "Python smtplib / FastAPI"
    message["Precedence"] = "bulk"
    message["Auto-Submitted"] = "auto-generated"
    message["List-Unsubscribe"] = f"<{DOMAIN}/unsubscribe>"

    part1 = MIMEText(text, "plain")
    message.attach(part1)
    
    if html:
        part2 = MIMEText(html, "html")
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
