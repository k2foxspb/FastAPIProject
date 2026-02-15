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
        subject = "Уведомление от системы FastAPI Project"
        body_text = f"Здравствуйте!\n\nЭто уведомление из вашего личного кабинета.\n\nСообщение:\n{message}\n\n---\nС уважением,\nКоманда {os.getenv('MAIL_FROM_NAME')}"
        
        body_html = f"""
        <html>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
              <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Новое уведомление</h2>
              <p>Здравствуйте!</p>
              <p>Вы получили новое сообщение в системе <strong>{os.getenv('MAIL_FROM_NAME')}</strong>:</p>
              <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #3498db; margin: 20px 0;">
                {message}
              </div>
              <p style="font-size: 14px; color: #7f8c8d;">Если вы получили это письмо по ошибке, пожалуйста, проигнорируйте его.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              <p style="font-size: 12px; color: #95a5a6;">Это автоматическое сообщение, на него не нужно отвечать.</p>
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
