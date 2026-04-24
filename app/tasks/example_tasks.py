import asyncio
import time
import os
from app.core.celery_app import celery_app
from app.utils.emails import send_email
from loguru import logger

@celery_app.task(name="send_notification")
def send_notification(email: str, message: str):
    """Задача для отправки уведомления на почту."""
    logger.info(f"Starting Celery task send_notification for {email}")
    try:
        subject = f"Уведомление от системы {os.getenv('MAIL_FROM_NAME', 'FastAPI Project')}"
        body_text = f"""Здравствуйте!

Это важное уведомление по вашему аккаунту в системе {os.getenv('MAIL_FROM_NAME', 'FastAPI Project')}.

Сообщение:
{message}

Если у вас возникли вопросы, вы можете ответить на это письмо или связаться с нашей поддержкой.

---
С уважением,
Команда {os.getenv('MAIL_FROM_NAME', 'FastAPI Project')}
"""
        
        body_html = f"""
        <html>
          <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background-color: #f4f7f9; padding: 20px;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 40px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
              <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 15px; margin-top: 0;">Уведомление системы</h2>
              <p style="font-size: 16px;">Здравствуйте!</p>
              <p style="font-size: 16px;">Вы получили новое важное сообщение в системе <strong>{os.getenv('MAIL_FROM_NAME', 'FastAPI Project')}</strong>:</p>
              <div style="background-color: #fdfdfd; padding: 20px; border: 1px solid #e1e8ed; border-left: 5px solid #3498db; margin: 25px 0; border-radius: 4px; font-style: italic;">
                {message}
              </div>
              <p style="font-size: 14px; color: #7f8c8d; margin-top: 30px;">Это информационное письмо. Если вы считаете, что получили его по ошибке, пожалуйста, сообщите нам.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
              <p style="font-size: 12px; color: #95a5a6; text-align: center;">© 2026 {os.getenv('MAIL_FROM_NAME', 'FastAPI Project')}. Все права защищены.</p>
            </div>
          </body>
        </html>
        """
        
        logger.info(f"Using SMTP server: {os.getenv('MAIL_SERVER')} with user: {os.getenv('MAIL_USERNAME')}")
        # Выполняем асинхронную функцию в синхронном контексте Celery
        asyncio.run(send_email(email, subject, body_text, body_html))
        
        logger.info(f"Celery task send_notification finished successfully for {email}")
        return {"status": "success", "to": email}
    except Exception as e:
        logger.error(f"Celery task send_notification failed for {email}: {e}")
        return {"status": "error", "message": str(e)}

@celery_app.task(name="process_image")
def process_image(image_path: str):
    """Пример задачи для обработки изображений."""
    time.sleep(10)  # Имитация обработки
    print(f"Image processed: {image_path}")
    return {"status": "processed", "path": image_path}

