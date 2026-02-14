from typing import Dict, List, Optional
import json
import os
import uuid
import io
from datetime import datetime
from PIL import Image
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, UploadFile, File, Form, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, func, update
import jwt

from app.core.config import SECRET_KEY, ALGORITHM
from app.api.dependencies import get_async_db
from app.models.chat import ChatMessage, FileUploadSession
from app.models.users import User as UserModel
from app.schemas.chat import (
    ChatMessageCreate, ChatMessageResponse, DialogResponse, 
    UploadInitRequest, UploadSessionResponse, UploadStatusResponse,
    BulkDeleteMessagesRequest
)
from app.api.routers.notifications import manager as notifications_manager

router = APIRouter(prefix="/chat", tags=["chat"])

class ChatManager:
    def __init__(self):
        # user_id -> list of websockets
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
        if user_id in self.active_connections:
            for connection in self.active_connections[user_id]:
                await connection.send_json(message)

manager = ChatManager()

async def get_user_from_token(token: str, db: AsyncSession):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
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

@router.websocket("/ws/{token}")
async def websocket_chat_endpoint(
    websocket: WebSocket,
    token: str,
    db: AsyncSession = Depends(get_async_db)
):
    # Accept immediately to avoid handshake rejection issues
    await websocket.accept()

    user_id = await get_user_from_token(token, db)
    if user_id is None:
        print(f"Chat WS rejected: invalid token {token[:10]}...")
        await websocket.close(code=4003)
        return

    # Using our custom connect that doesn't call accept() again
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
                    "timestamp": new_msg.timestamp.isoformat(),
                    "is_read": False
                }
                await manager.send_personal_message(response_data, receiver_id)
                # Отправляем подтверждение отправителю
                await manager.send_personal_message(response_data, user_id)

                # Уведомляем через глобальный WS уведомлений
                await notifications_manager.send_personal_message({
                    "type": "new_message",
                    "data": response_data
                }, receiver_id)

    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id)
    except Exception:
        manager.disconnect(websocket, user_id)

@router.get("/history/{other_user_id}", response_model=List[ChatMessageResponse])
async def get_chat_history(
    other_user_id: int,
    token: str,
    limit: int = 15,
    skip: int = 0,
    db: AsyncSession = Depends(get_async_db)
):
    user_id = await get_user_from_token(token, db)
    if user_id is None:
        return []

    result = await db.execute(
        select(ChatMessage).where(
            or_(
                and_(ChatMessage.sender_id == user_id, ChatMessage.receiver_id == other_user_id, ChatMessage.deleted_by_sender == False),
                and_(ChatMessage.sender_id == other_user_id, ChatMessage.receiver_id == user_id, ChatMessage.deleted_by_receiver == False)
            )
        ).order_by(ChatMessage.timestamp.desc())
        .offset(skip)
        .limit(limit)
    )
    messages = result.scalars().all()
    # Возвращаем в обратном хронологическом порядке для FlatList inverted
    return messages

@router.get("/dialogs", response_model=List[DialogResponse])
async def get_dialogs(
    token: str,
    db: AsyncSession = Depends(get_async_db)
):
    user_id = await get_user_from_token(token, db)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token")

    # Находим всех собеседников
    # Сначала те, кому мы писали
    sent_to = select(ChatMessage.receiver_id).where(ChatMessage.sender_id == user_id)
    # Потом те, кто нам писал
    received_from = select(ChatMessage.sender_id).where(ChatMessage.receiver_id == user_id)
    
    # Объединяем id собеседников
    partners_query = sent_to.union(received_from)
    partners_result = await db.execute(partners_query)
    partner_ids = partners_result.scalars().all()

    dialogs = []
    for p_id in partner_ids:
        if p_id == user_id: continue # На всякий случай

        # Получаем данные пользователя
        user_res = await db.execute(select(UserModel).where(UserModel.id == p_id))
        partner = user_res.scalar_one_or_none()
        if not partner: continue

        # Последнее сообщение в диалоге
        last_msg_res = await db.execute(
            select(ChatMessage).where(
                or_(
                    and_(ChatMessage.sender_id == user_id, ChatMessage.receiver_id == p_id, ChatMessage.deleted_by_sender == False),
                    and_(ChatMessage.sender_id == p_id, ChatMessage.receiver_id == user_id, ChatMessage.deleted_by_receiver == False)
                )
            ).order_by(ChatMessage.timestamp.desc()).limit(1)
        )
        last_msg = last_msg_res.scalar_one_or_none()
        
        # Кол-во непрочитанных от этого пользователя
        unread_res = await db.execute(
            select(func.count(ChatMessage.id)).where(
                ChatMessage.sender_id == p_id,
                ChatMessage.receiver_id == user_id,
                ChatMessage.is_read == 0,
                ChatMessage.deleted_by_receiver == False
            )
        )
        unread_count = unread_res.scalar()

        dialogs.append({
            "user_id": p_id,
            "email": partner.email,
            "first_name": partner.first_name,
            "last_name": partner.last_name,
            "avatar_url": getattr(partner, 'avatar_url', None), # Используем getattr если поля нет в модели
            "last_message": last_msg.message if last_msg and last_msg.message else "[Файл]",
            "last_message_time": last_msg.timestamp if last_msg else datetime.utcnow(),
            "unread_count": unread_count or 0,
            "status": partner.status,
            "last_seen": partner.last_seen
        })

    # Сортируем по времени последнего сообщения
    dialogs.sort(key=lambda x: x["last_message_time"], reverse=True)
    return dialogs

@router.post("/mark-as-read/{other_user_id}")
async def mark_messages_as_read(
    other_user_id: int,
    token: str,
    db: AsyncSession = Depends(get_async_db)
):
    user_id = await get_user_from_token(token, db)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token")

    await db.execute(
        update(ChatMessage)
        .where(
            ChatMessage.sender_id == other_user_id,
            ChatMessage.receiver_id == user_id,
            ChatMessage.is_read == 0
        )
        .values(is_read=1)
    )
    await db.commit()

    # Уведомляем пользователя об обновлении счетчиков
    await notifications_manager.send_personal_message({
        "type": "messages_read",
        "data": {"from_user_id": other_user_id}
    }, user_id)

    return {"status": "ok"}

@router.delete("/message/{message_id}")
async def delete_message(
    message_id: int,
    token: str,
    db: AsyncSession = Depends(get_async_db)
):
    user_id = await get_user_from_token(token, db)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token")

    result = await db.execute(select(ChatMessage).where(ChatMessage.id == message_id))
    message = result.scalar_one_or_none()

    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    is_sender = message.sender_id == user_id
    is_receiver = message.receiver_id == user_id

    if not is_sender and not is_receiver:
        raise HTTPException(status_code=403, detail="You can only delete messages you are involved in")

    # Сохраняем информацию для уведомления перед удалением
    receiver_id = message.receiver_id
    sender_id = message.sender_id
    file_path = message.file_path

    if is_sender:
        # Если удаляет отправитель — удаляем для всех (физически)
        await db.delete(message)
    else:
        # Если удаляет получатель — помечаем удаленным только для него
        message.deleted_by_receiver = True
    
    await db.commit()

    # Если был файл и сообщение удалено физически, удаляем файл
    if is_sender and file_path:
        try:
            # Превращаем относительный путь в абсолютный
            root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            abs_path = os.path.join(root_dir, file_path.lstrip("/"))
            if os.path.exists(abs_path):
                os.remove(abs_path)
        except Exception as e:
            print(f"Error deleting chat file: {e}")

    # Уведомляем участников через WebSocket чата
    delete_event = {
        "type": "message_deleted",
        "message_id": message_id,
        "sender_id": sender_id,
        "receiver_id": receiver_id,
        "deleted_for_all": is_sender
    }
    
    # Если удалено для всех, уведомляем обоих. 
    # Если только для себя, уведомляем только себя (чтобы интерфейс обновился)
    if is_sender:
        await manager.send_personal_message(delete_event, receiver_id)
        await manager.send_personal_message(delete_event, user_id)
        await notifications_manager.send_personal_message(delete_event, receiver_id)
        await notifications_manager.send_personal_message(delete_event, user_id)
    else:
        await manager.send_personal_message(delete_event, user_id)
        await notifications_manager.send_personal_message(delete_event, user_id)

    return {"status": "ok"}

@router.post("/messages/bulk-delete")
async def bulk_delete_messages(
    request: BulkDeleteMessagesRequest,
    token: str,
    db: AsyncSession = Depends(get_async_db)
):
    user_id = await get_user_from_token(token, db)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token")

    result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id.in_(request.message_ids),
            or_(
                ChatMessage.sender_id == user_id,
                ChatMessage.receiver_id == user_id
            )
        )
    )
    messages = result.scalars().all()
    
    if not messages:
        return {"status": "ok", "deleted_count": 0}

    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    deleted_ids = []
    for msg in messages:
        receiver_id = msg.receiver_id
        sender_id = msg.sender_id
        file_path = msg.file_path
        message_id = msg.id
        
        is_sender = sender_id == user_id
        
        if is_sender:
            await db.delete(msg)
            # Удаляем файлы
            if file_path:
                try:
                    abs_path = os.path.join(root_dir, file_path.lstrip("/"))
                    if os.path.exists(abs_path):
                        os.remove(abs_path)
                except Exception as e:
                    print(f"Error deleting chat file: {e}")
        else:
            msg.deleted_by_receiver = True

        deleted_ids.append(message_id)
        
        # Уведомляем участников
        delete_event = {
            "type": "message_deleted",
            "message_id": message_id,
            "sender_id": sender_id,
            "receiver_id": receiver_id,
            "deleted_for_all": is_sender
        }
        
        if is_sender:
            await manager.send_personal_message(delete_event, receiver_id)
            await manager.send_personal_message(delete_event, user_id)
            await notifications_manager.send_personal_message(delete_event, receiver_id)
            await notifications_manager.send_personal_message(delete_event, user_id)
        else:
            await manager.send_personal_message(delete_event, user_id)
            await notifications_manager.send_personal_message(delete_event, user_id)

    await db.commit()
    return {"status": "ok", "deleted_count": len(deleted_ids)}

@router.post("/upload")
async def upload_chat_file(
    file: UploadFile = File(...),
    # db: AsyncSession = Depends(get_async_db) # Пока не используем, но может пригодиться для проверок
):
    # В реальном приложении здесь должна быть проверка токена
    file_extension = os.path.splitext(file.filename)[1]
    unique_filename = f"{uuid.uuid4()}{file_extension}"
    
    # Используем абсолютный путь относительно корня приложения
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    chat_media_dir = os.path.join(root_dir, "media", "chat")
    os.makedirs(chat_media_dir, exist_ok=True)
    file_path = os.path.join(chat_media_dir, unique_filename)
    
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
        thumb_path = os.path.join(chat_media_dir, thumb_filename)
        try:
            with Image.open(io.BytesIO(content)) as img:
                img.thumbnail((200, 200))
                img.save(thumb_path)
        except Exception:
            pass
    elif file_extension_lower in [".mp4", ".webm", ".ogg"]:
        message_type = "video"
    elif file_extension_lower in [".m4a", ".mp3", ".wav", ".aac", ".amr", ".3gp"]:
        message_type = "voice"
    elif file_extension_lower in [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".zip", ".rar"]:
        message_type = "file"
        
    relative_path = f"/media/chat/{unique_filename}"
    return {"file_path": relative_path, "message_type": message_type}

@router.post("/upload/init", response_model=UploadSessionResponse)
async def init_upload(
    req: UploadInitRequest,
    token: str,
    db: AsyncSession = Depends(get_async_db)
):
    try:
        user_id = await get_user_from_token(token, db)
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        upload_id = str(uuid.uuid4())
        new_session = FileUploadSession(
            id=upload_id,
            user_id=user_id,
            filename=req.filename,
            file_size=req.file_size,
            mime_type=req.mime_type
        )
        db.add(new_session)
        await db.commit()
        
        return {"upload_id": upload_id, "offset": 0}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in init_upload: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/upload/status/{upload_id}", response_model=UploadStatusResponse)
async def get_upload_status(
    upload_id: str,
    token: str,
    db: AsyncSession = Depends(get_async_db)
):
    user_id = await get_user_from_token(token, db)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token")
        
    res = await db.execute(select(FileUploadSession).where(FileUploadSession.id == upload_id))
    session = res.scalar_one_or_none()
    
    if not session or session.user_id != user_id:
        raise HTTPException(status_code=404, detail="Upload session not found")
        
    return {
        "upload_id": session.id,
        "offset": session.offset,
        "is_completed": bool(session.is_completed)
    }

@router.post("/upload/chunk/{upload_id}")
async def upload_chunk(
    upload_id: str,
    token: Optional[str] = Form(None),
    offset: Optional[int] = Form(None),
    q_offset: Optional[int] = Query(None),
    q_token: Optional[str] = Query(None),
    chunk: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_async_db)
):
    print(f"DEBUG: upload_chunk called for {upload_id}")
    print(f"DEBUG: Params: offset={offset}, q_offset={q_offset}, token={token[:10] if token else None}, q_token={q_token[:10] if q_token else None}")
    
    # Support token and offset from multiple sources for maximum resilience
    actual_token = token or q_token
    actual_offset = offset if offset is not None else q_offset
    
    if actual_token is None:
        print("DEBUG: Missing token")
        raise HTTPException(status_code=401, detail="Missing token")
    
    # Clean token (remove potential quotes)
    actual_token = actual_token.strip().strip('"').strip("'")

    if actual_offset is None:
        print("DEBUG: Missing offset")
        raise HTTPException(status_code=422, detail="Missing offset")
        
    if chunk is None:
        print("DEBUG: Missing chunk file")
        # Log all fields for debugging
        return {"status": "error", "message": "Missing chunk", "debug_received_params": {
            "offset": offset, "q_offset": q_offset, "token_provided": bool(actual_token)
        }}

    user_id = await get_user_from_token(actual_token, db)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token")
        
    res = await db.execute(select(FileUploadSession).where(FileUploadSession.id == upload_id))
    session = res.scalar_one_or_none()
    
    if not session or session.user_id != user_id:
        raise HTTPException(status_code=404, detail="Upload session not found")
    
    if session.is_completed:
        raise HTTPException(status_code=400, detail="Upload already completed")
        
    if actual_offset != session.offset:
        return {"status": "error", "message": "Offset mismatch", "current_offset": session.offset}

    # Путь к временному файлу
    # Используем абсолютный путь относительно корня приложения
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    temp_dir = os.path.join(root_dir, "media", "temp")
    os.makedirs(temp_dir, exist_ok=True)
    file_path = os.path.join(temp_dir, f"{upload_id}_{session.filename}")
    
    # Записываем чанк
    mode = "ab" if actual_offset > 0 else "wb"
    with open(file_path, mode) as f:
        content = await chunk.read()
        f.write(content)
        session.offset += len(content)
    
    if session.offset >= session.file_size:
        session.is_completed = 1
        # Перемещаем в постоянное хранилище
        final_dir = os.path.join(root_dir, "media", "chat")
        os.makedirs(final_dir, exist_ok=True)
        
        file_extension = os.path.splitext(session.filename)[1]
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        final_path = os.path.join(final_dir, unique_filename)
        
        os.rename(file_path, final_path)
        
        # Определяем тип (по аналогии с обычным upload)
        message_type = "file"
        if file_extension.lower() in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
            message_type = "image"
        elif file_extension.lower() in [".mp4", ".webm", ".ogg"]:
            message_type = "video"
        elif file_extension.lower() in [".m4a", ".mp3", ".wav", ".aac", ".amr", ".3gp"]:
            message_type = "voice"
            
        await db.commit()
        return {
            "status": "completed",
            "file_path": f"/media/chat/{unique_filename}",
            "message_type": message_type
        }
    
    await db.commit()
    return {"status": "ok", "offset": session.offset}
