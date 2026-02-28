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

    subject = f"Подтверждение регистрации — {MAIL_FROM_NAME}"
    
    text = f"""Здравствуйте!

Мы рады приветствовать вас в нашем сервисе {MAIL_FROM_NAME}!

Для завершения регистрации и подтверждения вашего электронного адреса, пожалуйста, перейдите по следующей ссылке:
{verification_url}

Если у вас установлено мобильное приложение, вы можете открыть ссылку напрямую:
{MOBILE_DEEPLINK}?token={token}

Если ссылка не открывается, скопируйте её и вставьте в адресную строку вашего браузера.

Если вы не регистрировались на нашем сайте и не запрашивали это письмо, просто проигнорируйте его. Ваша учетная запись не будет активирована без подтверждения.

С уважением,
Команда {MAIL_FROM_NAME}
"""
    
    html = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #4A90E2;">Добро пожаловать в {MAIL_FROM_NAME}!</h2>
          <p>Здравствуйте!</p>
          <p>Благодарим вас за регистрацию. Чтобы начать пользоваться всеми возможностями нашего сервиса, пожалуйста, подтвердите ваш адрес электронной почты.</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="{verification_url}" 
               style="background-color: #4A90E2; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
               Подтвердить Email
            </a>
            <p style="margin-top: 15px; font-size: 14px;">
              <a href="{MOBILE_DEEPLINK}?token={token}" style="color: #4A90E2;">Открыть сразу в приложении</a>
            </p>
          </div>
          
          <p>Или перейдите по прямой ссылке:</p>
          <p style="word-break: break-all;"><a href="{verification_url}" style="color: #4A90E2;">{verification_url}</a></p>
          
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          
          <p style="font-size: 12px; color: #777;">
            Вы получили это письмо, потому что указали данный адрес при регистрации в {MAIL_FROM_NAME}.<br>
            Если вы этого не делали, просто проигнорируйте это письмо.
          </p>
          <p style="font-size: 12px; color: #777;">
            © {formatdate(localtime=True).split(' ')[3]} {MAIL_FROM_NAME}. Все права защищены.
          </p>
        </div>
      </body>
    </html>
    """
    await send_email(email, subject, text, html)

async def send_welcome_email(email: str):
    logger.info(f"Sending welcome email to {email}")
    subject = f"Добро пожаловать в {MAIL_FROM_NAME}!"
    
    text = f"""Здравствуйте!

Благодарим вас за интерес к нашему сервису {MAIL_FROM_NAME}. 
Мы очень рады видеть вас среди наших пользователей!

В следующем письме вы получите ссылку для подтверждения вашего аккаунта. Пожалуйста, обязательно перейдите по ней, чтобы активировать все возможности сервиса.

Если у вас возникнут вопросы, мы всегда готовы помочь!

С уважением,
Команда {MAIL_FROM_NAME}
"""
    
    html = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #4A90E2;">Рады вашему присоединению!</h2>
          <p>Здравствуйте!</p>
          <p>Благодарим вас за регистрацию в <strong>{MAIL_FROM_NAME}</strong>. Мы создаем лучший продукт для наших пользователей и рады, что вы теперь с нами.</p>
          <p>Для завершения настройки аккаунта нам необходимо подтвердить вашу почту. <strong>Письмо с ссылкой для подтверждения придет следом за этим сообщением.</strong></p>
          
          <p>Оставайтесь на связи!</p>
          
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 12px; color: #777;">
            © {formatdate(localtime=True).split(' ')[3]} {MAIL_FROM_NAME}. Все права защищены.
          </p>
        </div>
      </body>
    </html>
    """
    await send_email(email, subject, text, html)

async def send_welcome_and_verification_email(email: str, token: str):
    """Отправляет приветствие, а затем письмо верификации с паузой."""
    await send_welcome_email(email)
    import asyncio
    await asyncio.sleep(3)
    await send_verification_email(email, token)

async def send_email(email: str, subject: str, text: str, html: str | None = None):
    logger.info(f"Sending email to {email} with subject: {subject}")
    
    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = formataddr((MAIL_FROM_NAME, MAIL_FROM))
    message["To"] = email
    message["Reply-To"] = MAIL_FROM
    message["X-Mailer"] = "Python-FastAPI-Mailer"
    
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
