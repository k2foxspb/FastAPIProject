from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, EmailStr
from app.tasks.example_tasks import send_notification, process_image

router = APIRouter(prefix="/tasks", tags=["tasks"])

class EmailTaskRequest(BaseModel):
    email: EmailStr
    message: str

class ImageTaskRequest(BaseModel):
    image_path: str

@router.post("/send-email")
async def trigger_email_task(request: EmailTaskRequest):
    """
    Запуск фоновой задачи через Celery.
    Данные передаются в теле JSON запроса.
    """
    task = send_notification.delay(request.email, request.message)
    return {"task_id": task.id, "status": "Pending"}

@router.post("/process-image")
async def trigger_image_task(request: ImageTaskRequest):
    """
    Запуск задачи обработки изображения.
    """
    task = process_image.delay(request.image_path)
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
