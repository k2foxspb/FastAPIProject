from datetime import timezone, timedelta, datetime
from typing import List

from fastapi import APIRouter, BackgroundTasks, Request
from loguru import logger
from starlette.responses import HTMLResponse
from starlette.templating import Jinja2Templates
from starlette.websockets import WebSocketDisconnect, WebSocket

from app.core.celery_app import celery_app as celery
from app.tasks.example_tasks import send_notification as call_background_task
from app.core.fcm import send_fcm_notification


router = APIRouter(prefix="", tags=["health"])


@router.get("/1")
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
async def test_celery_task(email: str = "k2foxspb@gmail.com"):
    """Тестовый эндпоинт для проверки Celery."""
    call_background_task.delay(email, 'Это тестовое сообщение из эндпоинта health-check')
    return {"message": f"Task sent to Celery for {email}"}


@router.get("/test-fcm-log")
async def test_fcm_log():
    """Тестовый эндпоинт для проверки логов FCM."""
    logger.info("FCM Log test: Triggering send_fcm_notification")
    # Используем несуществующий токен, чтобы вызвать ошибку или предупреждение, 
    # но главное — увидеть логи в выводе.
    await send_fcm_notification(
        token="test_token_123",
        title="Test FCM Log",
        body="This is a test notification to check logging"
    )
    return {"message": "FCM notification attempt logged"}
templates = Jinja2Templates(directory="app/templates")
@router.get("/", response_class=HTMLResponse)
def read_index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})




class ConnectionManager:
    def __init__(self):
        self.connections: List[WebSocket] = []
        print("Creating a list to active connections", self.connections)

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.connections.append(websocket)
        print("New Active connections are ", self.connections)

    async def broadcast(self, data: str):
        for connection in self.connections:
            await connection.send_text(data)
            print("In broadcast: sent msg to ", connection)

manager = ConnectionManager()

@router.websocket("/ws/test/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: int):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast(f"Client {client_id}: {data}")
    except WebSocketDisconnect as e:
        manager.connections.remove(websocket)
        print(f'Connection closed {e.code}')
