from typing import Dict, List
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import update, select, func
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
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        
        # Close and remove any existing stale connections for this user if they are already connected
        # Optional: Some apps allow multiple tabs/devices, so we just add to the list.
        # But if the user has many stale ones, we might want to prune them.
        self.active_connections[user_id].append(websocket)
        logger.debug(f"NotificationsManager: User {user_id} connected. Active sockets: {len(self.active_connections[user_id])}")

    def disconnect(self, websocket: WebSocket, user_id: int):
        if user_id in self.active_connections:
            try:
                self.active_connections[user_id].remove(websocket)
                if not self.active_connections[user_id]:
                    del self.active_connections[user_id]
                logger.debug(f"NotificationsManager: User {user_id} disconnected. Remaining sockets: {len(self.active_connections.get(user_id, []))}")
            except ValueError:
                pass

    async def send_personal_message(self, message: dict, user_id: int):
        logger.debug(f"NotificationsManager trying to send message to user {user_id}. Type: {type(user_id)}")
        logger.debug(f"Active connections: {list(self.active_connections.keys())}")
        if user_id in self.active_connections:
            tasks = [connection.send_json(message) for connection in self.active_connections[user_id]]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    logger.error(f"NotificationsManager failed to send to user {user_id}: {result}")
                else:
                    logger.debug(f"NotificationsManager sent message to user {user_id}: {message.get('type')}")
        else:
            logger.debug(f"User {user_id} NOT found in active connections.")

    async def broadcast(self, message: dict):
        tasks = []
        for user_id in self.active_connections:
            for connection in self.active_connections[user_id]:
                tasks.append(connection.send_json(message))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

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
    last_seen = None
    if status == "offline":
        last_seen = datetime.utcnow().isoformat()
    
    await db.execute(
        update(UserModel)
        .where(UserModel.id == user_id)
        .values(status=status, last_seen=last_seen if status == "offline" else UserModel.last_seen)
    )
    await db.commit()
    
    # Получаем актуальный last_seen из базы, если мы его не обновляли (для online)
    if status == "online":
        result = await db.execute(select(UserModel.last_seen).where(UserModel.id == user_id))
        last_seen = result.scalar()
        
    return last_seen

@router.websocket("/notifications")
async def websocket_endpoint(
    websocket: WebSocket
):
    # Accept the connection first to prevent 403 Forbidden on handshake
    # Note: We must accept before we can reliably read query params or headers in some environments
    logger.info("New WS Connection request received at /notifications")
    try:
        await websocket.accept()
        logger.info("WS connection accepted on server side")
    except Exception as e:
        logger.error(f"WS accept failed: {e}")
        return
    
    token = websocket.query_params.get("token")
    if token:
        token = token.strip().strip('"').strip("'")
        
    logger.info(f"WS Attempt (notifications): token={token[:10]}..." if token else "WS Attempt (notifications): no token")

    if not token or token == "null" or token == "undefined":
        logger.warning(f"WS Connection rejected: missing or invalid token ('{token}')")
        await websocket.close(code=4003)
        return

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

            # Send initial friend request count
            from app.api.routers.users import get_friend_requests
            try:
                # We need a proper user object or just user_id if the function allows
                # get_friend_requests(db, current_user)
                # Let's just do a direct query for simplicity to avoid dependency hell
                from app.models.users import Friendship
                result = await db.execute(
                    select(func.count(Friendship.id)).where(
                        Friendship.friend_id == user_id,
                        Friendship.status == "pending"
                    )
                )
                count = result.scalar()
                await websocket.send_json({
                    "type": "friend_requests_count",
                    "count": count
                })
            except Exception as e:
                logger.error(f"Failed to send initial friend requests count: {e}")
    
        try:
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
