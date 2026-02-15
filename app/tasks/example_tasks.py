import asyncio
import time
from app.core.celery_app import celery_app
from app.utils.emails import send_email
from loguru import logger

@celery_app.task(name="send_notification")
def send_notification(email: str, message: str):
    """Задача для отправки уведомления на почту."""
    logger.info(f"Starting Celery task send_notification for {email}")
    try:
        subject = "Уведомление от FastAPI Project"
        # Выполняем асинхронную функцию в синхронном контексте Celery
        asyncio.run(send_email(email, subject, message))
        
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
