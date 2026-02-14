from typing import Dict, List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import update
import jwt
from datetime import datetime

from app.core.config import SECRET_KEY, ALGORITHM
from app.api.dependencies import get_async_db
from app.models.users import User as UserModel

router = APIRouter(prefix="/ws", tags=["websocket"])

class ConnectionManager:
    def __init__(self):
        # Храним активные подключения: {user_id: [websocket1, websocket2, ...]}
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)

    def disconnect(self, websocket: WebSocket, user_id: int):
        if user_id in self.active_connections:
            self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

    async def send_personal_message(self, message: dict, user_id: int):
        if user_id in self.active_connections:
            for connection in self.active_connections[user_id]:
                await connection.send_json(message)

    async def broadcast(self, message: dict):
        for user_id in self.active_connections:
            for connection in self.active_connections[user_id]:
                await connection.send_json(message)

manager = ConnectionManager()

async def get_user_from_token(token: str, db: AsyncSession):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = payload.get("id")
        if user_id is None:
            return None
        return user_id
    except jwt.PyJWTError:
        return None

async def update_user_status(user_id: int, status: str, db: AsyncSession):
    await db.execute(
        update(UserModel)
        .where(UserModel.id == user_id)
        .values(status=status, last_seen=datetime.now().isoformat() if status == "offline" else None)
    )
    await db.commit()

@router.websocket("/notifications")
async def websocket_endpoint(
    websocket: WebSocket,
    db: AsyncSession = Depends(get_async_db)
):
    token = websocket.query_params.get("token")

    if not token or token == "null" or token == "undefined":
        await websocket.close(code=4003)
        return

    user_id = await get_user_from_token(token, db)
    if user_id is None:
        await websocket.close(code=4003)
        return

    await manager.connect(websocket, user_id)
    await update_user_status(user_id, "online", db)
    
    try:
        while True:
            # Ожидаем данных от кли ента (пинги илипросто поддерживаем соединение)
            data = await websocket.receive_text()
            # Можно добавить обработку входящих сообщений, если нужно
    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id)
        await update_user_status(user_id, "offline", db)
