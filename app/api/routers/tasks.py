from fastapi import APIRouter, BackgroundTasks
from app.tasks.example_tasks import send_notification, process_image

router = APIRouter(prefix="/tasks", tags=["tasks"])

@router.post("/send-email")
async def trigger_email_task(email: str, message: str):
    """
    Запуск фоновой задачи через Celery.
    Используется для тяжелых задач, которые не должны блокировать ответ API.
    """
    task = send_notification.delay(email, message)
    return {"task_id": task.id, "status": "Pending"}

@router.post("/process-image")
async def trigger_image_task(image_path: str):
    """
    Запуск задачи обработки изображения.
    """
    task = process_image.delay(image_path)
    return {"task_id": task.id, "status": "Pending"}

@router.get("/status/{task_id}")
async def get_task_status(task_id: str):
    """
    Проверка статуса задачи.
    """
    from celery.result import AsyncResult
    from app.core.celery_app import celery_app
    
    result = AsyncResult(task_id, app=celery_app)
    return {
        "task_id": task_id,
        "status": result.status,
        "result": result.result if result.ready() else None
    }
