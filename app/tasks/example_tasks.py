import time
from app.core.celery_app import celery_app

@celery_app.task(name="send_notification")
def send_notification(email: str, message: str):
    """Пример задачи для отправки уведомления."""
    time.sleep(5)  # Имитация долгой работы
    print(f"Notification sent to {email}: {message}")
    return {"status": "success", "to": email}

@celery_app.task(name="process_image")
def process_image(image_path: str):
    """Пример задачи для обработки изображений."""
    time.sleep(10)  # Имитация обработки
    print(f"Image processed: {image_path}")
    return {"status": "processed", "path": image_path}
