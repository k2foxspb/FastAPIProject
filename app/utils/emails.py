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

async def send_verification_email(email: str, code: str):
    logger.info(f"Sending verification code email to {email}")

    subject = f"Код подтверждения для {MAIL_FROM_NAME}"
    
    text = f"""Здравствуйте!

Ваш одноразовый код для подтверждения адреса электронной почты в приложении {MAIL_FROM_NAME}: {code}

Пожалуйста, введите этот код в приложении для завершения регистрации. Это необходимо для обеспечения безопасности вашего аккаунта и подтверждения владения данным адресом почты.

Если вы не запрашивали этот код, просто проигнорируйте это письмо. Оно отправлено автоматически.

С уважением,
Команда {MAIL_FROM_NAME}
"""
    
    html = f"""
    <html>
      <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background-color: #f4f7f9; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 40px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
          <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 15px; margin-top: 0;">Подтверждение почты</h2>
          <p style="font-size: 16px;">Здравствуйте!</p>
          <p style="font-size: 16px;">Ваш код для подтверждения в приложении <strong>{MAIL_FROM_NAME}</strong>:</p>
          <div style="background-color: #fdfdfd; padding: 20px; border: 1px solid #e1e8ed; border-left: 5px solid #3498db; margin: 25px 0; border-radius: 4px; text-align: center;">
            <span style="font-size: 32px; font-weight: bold; color: #3498db;">{code}</span>
          </div>
          <p style="font-size: 16px;">Введите этот код на экране подтверждения в приложении.</p>
          <p style="font-size: 14px; color: #7f8c8d; margin-top: 30px;">Если вы не регистрировались в нашем приложении, просто удалите это письмо.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="font-size: 12px; color: #95a5a6; text-align: center;">© 2026 {MAIL_FROM_NAME}. Автоматическое уведомление.</p>
        </div>
      </body>
    </html>
    """
    
    await send_email(email, subject, text, html)

async def send_welcome_email(email: str):
    logger.info(f"Sending welcome email to {email}")
    subject = f"Добро пожаловать в {MAIL_FROM_NAME}!"
    
    text = f"""Здравствуйте!

Рады приветствовать вас в {MAIL_FROM_NAME}!

Мы получили ваш запрос на регистрацию. В ближайшее время вам придет второе письмо с кодом для подтверждения адреса вашей электронной почты. Это необходимо для активации вашего аккаунта.

Если у вас возникнут вопросы, вы всегда можете обратиться в нашу службу поддержки.

С уважением,
Команда {MAIL_FROM_NAME}
"""
    
    html = f"""
    <html>
      <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background-color: #f4f7f9; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 40px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
          <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 15px; margin-top: 0;">Добро пожаловать!</h2>
          <p style="font-size: 16px;">Здравствуйте!</p>
          <p style="font-size: 16px;">Мы очень рады, что вы решили присоединиться к <strong>{MAIL_FROM_NAME}</strong>.</p>
          <p style="font-size: 16px;">Через несколько секунд вам придет еще одно письмо с кодом подтверждения. Пожалуйста, используйте его для активации вашего профиля.</p>
          <div style="background-color: #eaf2f8; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px; color: #2980b9;">Это письмо не требует ответа.</p>
          </div>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="font-size: 12px; color: #95a5a6; text-align: center;">© 2026 {MAIL_FROM_NAME}. Все права защищены.</p>
        </div>
      </body>
    </html>
    """
    
    await send_email(email, subject, text, html)

async def send_welcome_and_verification_email(email: str, code: str):
    """Отправляет одно комбинированное письмо с приветствием и кодом (более надежно для антиспам-фильтров)."""
    logger.info(f"Sending combined welcome and verification email to {email}")
    subject = f"Код подтверждения для {MAIL_FROM_NAME}"
    
    text = f"""Здравствуйте!

Мы рады приветствовать вас в приложении {MAIL_FROM_NAME}!

Для завершения регистрации и подтверждения вашего адреса электронной почты, пожалуйста, используйте следующий код:

Ваш код подтверждения: {code}

Введите его в приложении на экране подтверждения для активации вашего аккаунта. Это необходимо для обеспечения безопасности вашего профиля и подтверждения владения данным адресом почты.

Если вы не регистрировались в {MAIL_FROM_NAME} и получили это письмо по ошибке, просто проигнорируйте его. Код будет аннулирован автоматически через некоторое время.

---
Безопасность: Никогда не передавайте этот код третьим лицам. Сотрудники {MAIL_FROM_NAME} никогда не запрашивают подобные коды доступа.

С уважением,
Команда {MAIL_FROM_NAME}
"""
    
    html = f"""
    <html>
      <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background-color: #f4f7f9; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 40px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 30px;">
             <h1 style="color: #2c3e50; margin: 0;">Добро пожаловать!</h1>
             <p style="color: #7f8c8d; font-size: 18px;">в приложение {MAIL_FROM_NAME}</p>
          </div>
          
          <p style="font-size: 16px;">Здравствуйте!</p>
          <p style="font-size: 16px;">Спасибо за регистрацию. Для подтверждения вашего профиля, пожалуйста, используйте следующий код:</p>
          
          <div style="background-color: #fdfdfd; padding: 30px; border: 1px solid #e1e8ed; border-left: 5px solid #3498db; margin: 25px 0; border-radius: 4px; text-align: center;">
            <div style="font-size: 14px; color: #7f8c8d; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px;">Ваш код подтверждения</div>
            <div style="font-size: 36px; font-weight: bold; color: #3498db;">{code}</div>
          </div>
          
          <p style="font-size: 16px;">Введите этот код на экране подтверждения в приложении, чтобы начать пользоваться всеми функциями сервиса. Этот код действителен в течение ограниченного времени и предназначен только для вашей учетной записи.</p>
          
          <div style="margin-top: 40px; padding: 20px; background-color: #f8f9fa; border-radius: 4px; border: 1px solid #e9ecef;">
            <p style="margin: 0; font-size: 13px; color: #6c757d;">
              <strong>Почему я получил это письмо?</strong><br>
              Мы получили запрос на регистрацию нового аккаунта с использованием этого адреса электронной почты. Если вы не делали этого запроса, просто проигнорируйте это сообщение.
            </p>
          </div>
          
          <div style="margin-top: 20px; padding: 20px; background-color: #fff9e6; border-radius: 4px; border: 1px solid #ffeeba;">
            <p style="margin: 0; font-size: 13px; color: #856404;">
              <strong>Безопасность:</strong> Никогда не передавайте этот код третьим лицам. Сотрудники {MAIL_FROM_NAME} никогда не запрашивают подобные коды доступа.
            </p>
          </div>
          
          <p style="font-size: 14px; color: #7f8c8d; margin-top: 30px;">Если вы не регистрировались у нас, просто удалите это письмо.</p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <div style="text-align: center;">
            <p style="font-size: 12px; color: #95a5a6; margin: 0;">© 2026 {MAIL_FROM_NAME}. Все права защищены.</p>
            <p style="font-size: 12px; color: #95a5a6; margin: 5px 0 0;">Это автоматическое сообщение, на него не нужно отвечать.</p>
          </div>
        </div>
      </body>
    </html>
    """
    
    await send_email(email, subject, text, html)

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
    message["Reply-To"] = formataddr((MAIL_FROM_NAME, MAIL_FROM or MAIL_USERNAME))
    
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
    message["X-Mailer"] = "Python smtplib"
    message["X-Auto-Response-Suppress"] = "All"
    message["X-Priority"] = "3 (Normal)"
    message["Priority"] = "normal"
    message["X-Entity-Ref-ID"] = make_msgid()
    
    # Рекомендация для Gmail/Yandex/Mail.ru: наличие Precedence: bulk может помочь при массовых рассылках, 
    # но для транзакционных писем лучше использовать list-unsubscribe если это уместно.
    # Для кода подтверждения мы просто сделаем письмо более "солидным".
    
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
