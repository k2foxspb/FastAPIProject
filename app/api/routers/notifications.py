from typing import Dict, List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import update, select
import jwt
from datetime import datetime

from app.core.config import SECRET_KEY, ALGORITHM
from app.api.dependencies import get_async_db
from app.models.users import User as UserModel
from loguru import logger

router = APIRouter(prefix="/ws", tags=["websocket"])

class ConnectionManager:
    def __init__(self):
        # Храним активные подключения: {user_id: [websocket1, websocket2, ...]}
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: int):
        # Removal of await websocket.accept() as it is handled by the endpoint
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)

    def disconnect(self, websocket: WebSocket, user_id: int):
        if user_id in self.active_connections:
            self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

    async def send_personal_message(self, message: dict, user_id: int):
        logger.debug(f"NotificationsManager trying to send message to user {user_id}. Type: {type(user_id)}")
        logger.debug(f"Active connections: {list(self.active_connections.keys())}")
        if user_id in self.active_connections:
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                    logger.debug(f"NotificationsManager sent message to user {user_id}: {message.get('type')}")
                except Exception as e:
                    logger.error(f"NotificationsManager failed to send to user {user_id}: {e}")
        else:
            logger.debug(f"User {user_id} NOT found in active connections.")

    async def broadcast(self, message: dict):
        for user_id in self.active_connections:
            for connection in self.active_connections[user_id]:
                await connection.send_json(message)

manager = ConnectionManager()

async def get_user_from_token(token: str, db: AsyncSession):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        # Try both 'id' and 'sub' (if sub is an ID or if we need to lookup by email)
        user_id = payload.get("id")
        email = payload.get("sub")
        
        if user_id:
            return int(user_id)
        
        if email:
            # Fallback to lookup by email if id is missing
            result = await db.execute(select(UserModel.id).where(UserModel.email == email))
            return result.scalar_one_or_none()
            
        return None
    except jwt.PyJWTError:
        return None

async def update_user_status(user_id: int, status: str, db: AsyncSession):
    last_seen = datetime.now().isoformat() if status == "offline" else None
    await db.execute(
        update(UserModel)
        .where(UserModel.id == user_id)
        .values(status=status, last_seen=last_seen)
    )
    await db.commit()
    return last_seen

@router.websocket("/notifications")
async def websocket_endpoint(
    websocket: WebSocket
):
    # Accept the connection first to prevent 403 Forbidden on handshake
    # Note: We must accept before we can reliably read query params or headers in some environments
    await websocket.accept()
    
    token = websocket.query_params.get("token")
    logger.info(f"WS Attempt (notifications): token={token[:10]}..." if token else "WS Attempt (notifications): no token")

    if not token or token == "null" or token == "undefined":
        logger.warning(f"WS Connection rejected: missing or invalid token ('{token}')")
        await websocket.close(code=4003)
        return

    # Clean token (remove potential quotes if passed incorrectly)
    token = token.strip().strip('"').strip("'")

    from app.database import async_session_maker
    user_id = None
    try:
        async with async_session_maker() as db:
            user_id = await get_user_from_token(token, db)
            if user_id is None:
                logger.warning(f"WS Connection rejected: invalid token payload for token: {token[:20]}...")
                await websocket.close(code=4003)
                return

            await manager.connect(websocket, user_id)
            logger.info(f"WS Connected: user_id={user_id}")
            last_seen = await update_user_status(user_id, "online", db)
            await manager.broadcast({
                "type": "user_status",
                "data": {
                    "user_id": user_id,
                    "status": "online",
                    "last_seen": last_seen
                }
            })
            
            while True:
                # Ожидаем данных от клиента (пинги или просто поддерживаем соединение)
                data = await websocket.receive_text()
                try:
                    import json
                    message_data = json.loads(data)
                    if message_data.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                except Exception:
                    pass
    except WebSocketDisconnect:
        if user_id is not None:
            logger.info(f"WS Disconnected: user_id={user_id}")
            manager.disconnect(websocket, user_id)
            async with async_session_maker() as db_off:
                last_seen = await update_user_status(user_id, "offline", db_off)
                await manager.broadcast({
                    "type": "user_status",
                    "data": {
                        "user_id": user_id,
                        "status": "offline",
                        "last_seen": last_seen
                    }
                })
    except Exception as e:
        logger.error(f"WS Error for user_id={user_id if user_id is not None else 'unknown'}: {e}")
        if user_id is not None:
            manager.disconnect(websocket, user_id)
            async with async_session_maker() as db_err:
                last_seen = await update_user_status(user_id, "offline", db_err)
                await manager.broadcast({
                    "type": "user_status",
                    "data": {
                        "user_id": user_id,
                        "status": "offline",
                        "last_seen": last_seen
                    }
                })
