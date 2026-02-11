from fastapi import APIRouter, BackgroundTasks, Request
from loguru import logger
from app.celery.tasks import call_background_task

router = APIRouter(prefix="", tags=["health"])


@router.get("/")
async def root():
    """Корневой маршрут, подтверждающий, что API работает."""
    logger.info("Root path accessed")
    return {"message": "Добро пожаловать в API интернет-магазина!"}


@router.get("/health")
async def health_check():
    """Проверка здоровья сервиса."""
    return {"status": "healthy"}


# Session endpoints (лучше переместить в отдельный router для auth/sessions)
@router.get("/create_session")
async def session_set(request: Request):
    """Создание сессии (для тестирования)."""
    request.session["my_session"] = "1234"
    return {"status": "ok"}


@router.get("/read_session")
async def session_info(request: Request):
    """Чтение сессии (для тестирования)."""
    my_var = request.session.get("my_session")
    return {"session": my_var}


@router.get("/delete_session")
async def session_delete(request: Request):
    """Удаление сессии (для тестирования)."""
    my_var = request.session.pop("my_session", None)
    return {"deleted_session": my_var}


# Тестовый эндпоинт для Celery (удалите в продакшене)
@router.get("/test-celery")
async def test_celery_task():
    """Тестовый эндпоинт для проверки Celery."""
    call_background_task.delay('test message')
    logger.info("Celery task dispatched")
    return {"message": "Task sent to Celery"}