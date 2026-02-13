from typing import Dict, List, Optional
import json
import os
import uuid
import io
from PIL import Image
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_
import jwt

from app.core.config import SECRET_KEY, ALGORITHM
from app.api.dependencies import get_async_db
from app.models.chat import ChatMessage
from app.schemas.chat import ChatMessageCreate, ChatMessageResponse

router = APIRouter(prefix="/chat", tags=["chat"])

class ChatManager:
    def __init__(self):
        # user_id -> list of websockets
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

manager = ChatManager()

async def get_user_from_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = payload.get("id")
        return user_id
    except jwt.PyJWTError:
        return None

@router.websocket("/ws/{token}")
async def websocket_chat_endpoint(
    websocket: WebSocket,
    token: str,
    db: AsyncSession = Depends(get_async_db)
):
    user_id = await get_user_from_token(token)
    if user_id is None:
        await websocket.close(code=4003)
        return

    await manager.connect(websocket, user_id)
    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            
            # Ожидаем формат {"receiver_id": int, "message": str, "file_path": str, "message_type": str}
            receiver_id = message_data.get("receiver_id")
            content = message_data.get("message")
            file_path = message_data.get("file_path")
            message_type = message_data.get("message_type", "text")
            
            if receiver_id and (content or file_path):
                # Сохраняем в базу
                new_msg = ChatMessage(
                    sender_id=user_id,
                    receiver_id=receiver_id,
                    message=content,
                    file_path=file_path,
                    message_type=message_type
                )
                db.add(new_msg)
                await db.commit()
                await db.refresh(new_msg)

                # Отправляем получателю
                response_data = {
                    "id": new_msg.id,
                    "sender_id": user_id,
                    "receiver_id": receiver_id,
                    "message": content,
                    "file_path": file_path,
                    "message_type": message_type,
                    "timestamp": new_msg.timestamp.isoformat()
                }
                await manager.send_personal_message(response_data, receiver_id)
                # Отправляем подтверждение отправителю
                await manager.send_personal_message(response_data, user_id)

    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id)
    except Exception:
        manager.disconnect(websocket, user_id)

@router.get("/history/{other_user_id}", response_model=List[ChatMessageResponse])
async def get_chat_history(
    other_user_id: int,
    token: str,
    db: AsyncSession = Depends(get_async_db)
):
    user_id = await get_user_from_token(token)
    if user_id is None:
        return []

    result = await db.execute(
        select(ChatMessage).where(
            or_(
                and_(ChatMessage.sender_id == user_id, ChatMessage.receiver_id == other_user_id),
                and_(ChatMessage.sender_id == other_user_id, ChatMessage.receiver_id == user_id)
            )
        ).order_by(ChatMessage.timestamp.asc())
    )
    return result.scalars().all()

@router.post("/upload")
async def upload_chat_file(
    file: UploadFile = File(...),
    # db: AsyncSession = Depends(get_async_db) # Пока не используем, но может пригодиться для проверок
):
    # В реальном приложении здесь должна быть проверка токена
    file_extension = os.path.splitext(file.filename)[1]
    unique_filename = f"{uuid.uuid4()}{file_extension}"
    file_path = os.path.join("app", "media", "chat", unique_filename)
    
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    
    with open(file_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)
    
    # Определяем тип сообщения на основе расширения
    message_type = "file"
    file_extension_lower = file_extension.lower()
    if file_extension_lower in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
        message_type = "image"
        # Генерируем миниатюру для изображений в чате
        thumb_filename = f"{os.path.splitext(unique_filename)[0]}_thumb{file_extension}"
        thumb_path = os.path.join("app", "media", "chat", thumb_filename)
        try:
            with Image.open(io.BytesIO(content)) as img:
                img.thumbnail((200, 200))
                img.save(thumb_path)
        except Exception:
            pass
    elif file_extension_lower in [".mp4", ".webm", ".ogg"]:
        message_type = "video"
        
    relative_path = f"/media/chat/{unique_filename}"
    return {"file_path": relative_path, "message_type": message_type}
