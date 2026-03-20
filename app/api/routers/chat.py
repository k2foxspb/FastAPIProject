from typing import Dict, List, Optional
import json
import asyncio
import os
import uuid
import io
from datetime import datetime, timedelta
from PIL import Image
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, UploadFile, File, Form, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, func, update
from sqlalchemy.orm import joinedload
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
from app.core.fcm import send_fcm_notification
from app.core.auth import get_current_user, get_current_user_optional
from loguru import logger
from app.utils import storage

router = APIRouter(prefix="/chat", tags=["chat"])

class ChatManager:
    def __init__(self):
        # user_id -> list of websockets
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: int):
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        logger.debug(f"ChatManager: User {user_id} connected. Sockets: {len(self.active_connections[user_id])}")

    def disconnect(self, websocket: WebSocket, user_id: int):
        if user_id in self.active_connections:
            try:
                self.active_connections[user_id].remove(websocket)
                if not self.active_connections[user_id]:
                    del self.active_connections[user_id]
                logger.debug(f"ChatManager: User {user_id} disconnected. Sockets: {len(self.active_connections.get(user_id, []))}")
            except ValueError:
                pass

    async def send_personal_message(self, message: dict, user_id: int):
        logger.debug(f"ChatManager trying to send message to user {user_id}. Connections: {len(self.active_connections.get(user_id, []))}")
        if user_id in self.active_connections:
            tasks = [connection.send_json(message) for connection in self.active_connections[user_id]]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    logger.error(f"ChatManager failed to send to user {user_id}: {result}")
                    # Remove broken connection
                    try:
                        self.active_connections[user_id].pop(i)
                    except:
                        pass
                else:
                    logger.debug(f"ChatManager sent message to user {user_id}: {message.get('id')}")
            
            if user_id in self.active_connections and not self.active_connections[user_id]:
                del self.active_connections[user_id]
        else:
            logger.debug(f"User {user_id} NOT connected to Chat WS")

manager = ChatManager()

async def get_user_from_token(token: str, db: AsyncSession):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("id")
        email = payload.get("sub")
        
        if not user_id and not email:
            return None
            
        # Всегда проверяем существование и активность пользователя в БД
        query = select(UserModel).where(UserModel.is_active == True)
        if user_id:
            query = query.where(UserModel.id == int(user_id))
        else:
            query = query.where(UserModel.email == email)
            
        result = await db.execute(query)
        return result.scalar_one_or_none()
    except Exception:
        return None

@router.websocket("/ws/{token}")
async def websocket_chat_endpoint(
    websocket: WebSocket,
    token: str,
    db: AsyncSession = Depends(get_async_db)
):
    # Accept immediately to avoid handshake rejection issues
    await websocket.accept()
    
    # Clean token (remove potential quotes if passed incorrectly)
    token = token.strip().strip('"').strip("'")

    user = await get_user_from_token(token, db)
    if user is None:
        logger.warning(f"Chat WS rejected: invalid token {token[:10]}...")
        await websocket.close(code=4003)
        return
        
    user_id = user.id
    await manager.connect(websocket, user_id)

    # Fetch sender info once for the session
    sender_name = f"{user.first_name} {user.last_name}".strip() if (user.first_name or user.last_name) else "Пользователь"
    if not sender_name: sender_name = "Пользователь"
    sender_avatar = user.avatar_url

    try:
        while True:
            data = await websocket.receive_text()
            try:
                message_data = json.loads(data)
            except json.JSONDecodeError as e:
                logger.error(f"Chat WS JSON error: {e}, data={data[:100]}")
                continue
            
            # Обработка разных типов сообщений через WebSocket
            msg_type = message_data.get("type", "message")
            
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            
            if msg_type == "get_dialogs":
                from app.api.routers.chat import get_dialogs as fetch_dialogs_api
                try:
                    dialogs_list = await fetch_dialogs_api(db=db, current_user=user)
                    # Конвертируем datetime в ISO формат для JSON
                    processed_dialogs = []
                    for d in dialogs_list:
                        d_dict = dict(d) if not isinstance(d, dict) else d.copy()
                        if isinstance(d_dict.get("last_message_time"), datetime):
                            d_dict["last_message_time"] = d_dict["last_message_time"].isoformat()
                        processed_dialogs.append(d_dict)

                    logger.info(f"Sending WS dialogs to user {user_id}, count: {len(processed_dialogs)}")
                    await websocket.send_json({
                        "type": "dialogs_list",
                        "data": processed_dialogs
                    })
                except Exception as e:
                    logger.error(f"WS get_dialogs error: {e}")
                continue
            
            if msg_type == "get_history":
                other_user_id = message_data.get("other_user_id")
                limit = message_data.get("limit", 15)
                skip = message_data.get("skip", 0)
                if other_user_id:
                    from app.api.routers.chat import get_chat_history as fetch_history_api
                    try:
                        history = await fetch_history_api(other_user_id=int(other_user_id), limit=limit, skip=skip, db=db, current_user=user)
                        # Конвертируем datetime в ISO формат для JSON
                        processed_history = []
                        for m in history:
                            m_dict = dict(m) if not isinstance(m, dict) else m.copy()
                            if isinstance(m_dict.get("timestamp"), datetime):
                                m_dict["timestamp"] = m_dict["timestamp"].isoformat()
                            processed_history.append(m_dict)
                        
                        logger.info(f"Sending WS history to user {user_id} for partner {other_user_id}, count: {len(processed_history)}")
                        await websocket.send_json({
                            "type": "chat_history",
                            "other_user_id": int(other_user_id),
                            "data": processed_history,
                            "skip": skip
                        })
                    except Exception as e:
                        logger.error(f"WS get_history error: {e}")
                continue
                
            logger.debug(f"Chat WS received message type '{msg_type}' from user {user_id}")

            if msg_type == "search_messages":
                other_user_id = message_data.get("other_user_id")
                query = message_data.get("query", "").lower()
                if other_user_id and query:
                    try:
                        stmt = select(ChatMessage).where(
                            or_(
                                and_(ChatMessage.sender_id == user_id, ChatMessage.receiver_id == int(other_user_id)),
                                and_(ChatMessage.sender_id == int(other_user_id), ChatMessage.receiver_id == user_id)
                            ),
                            or_(
                                func.lower(ChatMessage.message).contains(query),
                                func.lower(ChatMessage.file_path).contains(query)
                            )
                        ).order_by(ChatMessage.timestamp.desc())
                        
                        result = await db.execute(stmt)
                        found_messages = result.scalars().all()
                        
                        processed_results = []
                        for m in found_messages:
                            m_dict = {
                                "id": m.id,
                                "timestamp": m.timestamp.isoformat() if m.timestamp else None,
                                "message": m.message,
                                "file_path": m.file_path,
                                "sender_id": m.sender_id,
                                "receiver_id": m.receiver_id,
                                "message_type": m.message_type
                            }
                            processed_results.append(m_dict)
                            
                        await websocket.send_json({
                            "type": "search_results",
                            "other_user_id": int(other_user_id),
                            "query": query,
                            "data": processed_results
                        })
                    except Exception as e:
                        logger.error(f"WS search_messages error: {e}")
                continue
                
            if msg_type == "mark_read":
                other_id = message_data.get("other_id")
                if other_id:
                    await db.execute(
                        update(ChatMessage)
                        .where(
                            ChatMessage.sender_id == int(other_id),
                            ChatMessage.receiver_id == user_id,
                            ChatMessage.is_read == 0
                        )
                        .values(is_read=1)
                    )
                    await db.commit()
                    
                    # Уведомляем всех участников одновременно
                    await asyncio.gather(
                        notifications_manager.send_personal_message({
                            "type": "your_messages_read",
                            "data": {"reader_id": user_id}
                        }, int(other_id)),
                        manager.send_personal_message({
                            "type": "messages_read",
                            "reader_id": user_id
                        }, int(other_id)),
                        notifications_manager.send_personal_message({
                            "type": "messages_read",
                            "data": {"from_user_id": int(other_id)}
                        }, user_id),
                        return_exceptions=True
                    )
                continue

            if msg_type == "delete_message":
                message_id_raw = message_data.get("message_id")
                if message_id_raw:
                    try:
                        message_id = int(message_id_raw)
                    except (ValueError, TypeError):
                        logger.warning(f"Invalid message_id format in WS delete: {message_id_raw}")
                        continue
                        
                    result = await db.execute(select(ChatMessage).where(ChatMessage.id == message_id))
                    message = result.scalar_one_or_none()

                    if message:
                        is_sender = message.sender_id == user_id
                        is_receiver = message.receiver_id == user_id

                        if is_sender or is_receiver:
                            receiver_id = message.receiver_id
                            sender_id = message.sender_id
                            file_path = message.file_path

                            if is_sender:
                                # Вместо физического удаления используем soft delete для обоих сторон
                                # Это позволяет избежать проблем с reply_to_id и ссылочной целостностью
                                message.deleted_by_sender = True
                                message.deleted_by_receiver = True
                                logger.info(f"WS: Message {message_id} soft-deleted for all by sender {user_id}")
                            else:
                                message.deleted_by_receiver = True
                                logger.info(f"WS: Message {message_id} soft-deleted for receiver {user_id}")
                            
                            await db.commit()

                            # Если удалено отправителем ("для всех") и есть файл — удаляем его физически
                            if is_sender and file_path:
                                try:
                                    # Очищаем контент сообщения, чтобы он не занимал место и не светился в логах
                                    message.message = "[Сообщение удалено]"
                                    message.file_path = None
                                    await db.commit()
                                    
                                    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
                                    # Если это JSON список (media_group), удаляем все файлы
                                    if message.message_type == "media_group":
                                        try:
                                            attachments = json.loads(file_path)
                                            for att in attachments:
                                                att_path = att.get("file_path")
                                                if att_path:
                                                    abs_path = os.path.join(root_dir, att_path.lstrip("/"))
                                                    if os.path.exists(abs_path):
                                                        os.remove(abs_path)
                                        except: pass
                                    else:
                                        abs_path = os.path.join(root_dir, file_path.lstrip("/"))
                                        if os.path.exists(abs_path):
                                            os.remove(abs_path)
                                except Exception as e:
                                    logger.error(f"Error deleting chat file via WS: {e}")

                            delete_event = {
                                "type": "message_deleted",
                                "message_id": message_id,
                                "sender_id": sender_id,
                                "receiver_id": receiver_id,
                                "deleted_for_all": is_sender
                            }
                            
                            if is_sender:
                                await asyncio.gather(
                                    manager.send_personal_message(delete_event, receiver_id),
                                    manager.send_personal_message(delete_event, user_id),
                                    notifications_manager.send_personal_message(delete_event, receiver_id),
                                    notifications_manager.send_personal_message(delete_event, user_id),
                                    return_exceptions=True
                                )
                            else:
                                await asyncio.gather(
                                    manager.send_personal_message(delete_event, user_id),
                                    notifications_manager.send_personal_message(delete_event, user_id),
                                    return_exceptions=True
                                )
                continue

            if msg_type == "bulk_delete":
                message_ids_raw = message_data.get("message_ids", [])
                if message_ids_raw:
                    try:
                        message_ids = [int(mid) for mid in message_ids_raw]
                    except (ValueError, TypeError):
                        logger.warning(f"Invalid message_ids format in WS bulk delete")
                        continue
                        
                    result = await db.execute(
                        select(ChatMessage).where(
                            ChatMessage.id.in_(message_ids),
                            or_(
                                ChatMessage.sender_id == user_id,
                                ChatMessage.receiver_id == user_id
                            )
                        )
                    )
                    messages = result.scalars().all()
                    
                    if messages:
                        root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
                        
                        for msg in messages:
                            m_receiver_id = msg.receiver_id
                            m_sender_id = msg.sender_id
                            m_file_path = msg.file_path
                            m_id = msg.id
                            
                            m_is_sender = m_sender_id == user_id
                            
                            if m_is_sender:
                                # Soft delete для всех
                                msg.deleted_by_sender = True
                                msg.deleted_by_receiver = True
                                if m_file_path:
                                    try:
                                        msg.message = "[Сообщение удалено]"
                                        msg.file_path = None
                                        
                                        # Если это JSON список (media_group), удаляем все файлы
                                        if msg.message_type == "media_group":
                                            try:
                                                attachments = json.loads(m_file_path)
                                                for att in attachments:
                                                    att_path = att.get("file_path")
                                                    if att_path:
                                                        abs_path = os.path.join(root_dir, att_path.lstrip("/"))
                                                        if os.path.exists(abs_path):
                                                            os.remove(abs_path)
                                            except: pass
                                        else:
                                            m_abs_path = os.path.join(root_dir, m_file_path.lstrip("/"))
                                            if os.path.exists(m_abs_path):
                                                os.remove(m_abs_path)
                                    except Exception as e:
                                        logger.error(f"Error bulk deleting chat file via WS: {e}")
                            else:
                                msg.deleted_by_receiver = True

                            m_delete_event = {
                                "type": "message_deleted",
                                "message_id": m_id,
                                "sender_id": m_sender_id,
                                "receiver_id": m_receiver_id,
                                "deleted_for_all": m_is_sender
                            }
                            
                            if m_is_sender:
                                await asyncio.gather(
                                    manager.send_personal_message(m_delete_event, m_receiver_id),
                                    manager.send_personal_message(m_delete_event, user_id),
                                    notifications_manager.send_personal_message(m_delete_event, m_receiver_id),
                                    notifications_manager.send_personal_message(m_delete_event, user_id),
                                    return_exceptions=True
                                )
                            else:
                                await asyncio.gather(
                                    manager.send_personal_message(m_delete_event, user_id),
                                    notifications_manager.send_personal_message(m_delete_event, user_id),
                                    return_exceptions=True
                                )
                        await db.commit()
                continue

            if msg_type == "upload_started":
                receiver_id_raw = message_data.get("receiver_id")
                upload_id = message_data.get("upload_id")
                message_type = message_data.get("message_type", "file")
                client_id = message_data.get("client_id")
                duration = message_data.get("duration")
                reply_to_id = message_data.get("reply_to_id")
                if receiver_id_raw and upload_id:
                    try:
                        receiver_id = int(receiver_id_raw)
                    except (ValueError, TypeError):
                        logger.warning(f"Invalid receiver_id format in WS upload_started: {receiver_id_raw}")
                        continue

                    # Проверяем, есть ли уже плейсхолдер с таким client_id и upload_id
                    existing_msg = None
                    if client_id:
                        res_existing = await db.execute(
                            select(ChatMessage).where(
                                ChatMessage.client_id == client_id,
                                ChatMessage.sender_id == user_id,
                                ChatMessage.is_uploading == True,
                                ChatMessage.upload_id == upload_id
                            )
                        )
                        existing_msg = res_existing.scalars().first()

                    if existing_msg:
                        # Обновляем существующий placeholder
                        logger.debug(f"Updating existing placeholder message {existing_msg.id} for upload_started")
                        existing_msg.upload_id = upload_id
                        # Если новый тип более специфичный чем file, обновляем
                        if message_type != "file" or existing_msg.message_type == "text":
                            existing_msg.message_type = message_type
                        if duration:
                            existing_msg.duration = duration
                        if reply_to_id:
                            existing_msg.reply_to_id = reply_to_id
                        new_msg = existing_msg
                    else:
                        # Создаем placeholder-сообщение с признаком загрузки
                        new_msg = ChatMessage(
                            sender_id=user_id,
                            receiver_id=receiver_id,
                            message=None,
                            file_path=None,
                            message_type=message_type,
                            client_id=client_id,
                            duration=duration,
                            reply_to_id=reply_to_id,
                            is_uploading=True,
                            upload_id=upload_id
                        )
                        db.add(new_msg)
                    
                    await db.commit()
                    await db.refresh(new_msg)

                    # Готовим данные отвечаемого сообщения, если оно есть
                    reply_to_data = None
                    if reply_to_id:
                        try:
                            reply_res = await db.execute(
                                select(ChatMessage, UserModel.first_name, UserModel.last_name)
                                .join(UserModel, ChatMessage.sender_id == UserModel.id)
                                .where(ChatMessage.id == reply_to_id)
                            )
                            reply_row = reply_res.first()
                            if reply_row:
                                r_msg, r_fname, r_lname = reply_row
                                reply_to_data = {
                                    "id": r_msg.id,
                                    "message": r_msg.message,
                                    "message_type": r_msg.message_type,
                                    "sender_id": r_msg.sender_id,
                                    "sender_name": f"{r_fname} {r_lname}".strip() or "Пользователь"
                                }
                        except Exception as e:
                            logger.error(f"Error fetching reply_to message (upload_started): {e}")

                    response_data = {
                        "id": new_msg.id,
                        "client_id": client_id,
                        "sender_id": user_id,
                        "sender_name": sender_name,
                        "receiver_id": receiver_id,
                        "message": None,
                        "file_path": None,
                        "message_type": message_type,
                        "duration": duration,
                        "reply_to_id": reply_to_id,
                        "reply_to": reply_to_data,
                        "timestamp": new_msg.timestamp.isoformat(),
                        "is_read": 0,
                        "is_uploading": True,
                        "upload_id": upload_id
                    }

                    chat_event = {"type": "new_message", "data": response_data}
                    await asyncio.gather(
                        manager.send_personal_message(chat_event, receiver_id),
                        manager.send_personal_message(chat_event, user_id),
                        notifications_manager.send_personal_message(chat_event, receiver_id),
                        notifications_manager.send_personal_message(chat_event, user_id),
                        return_exceptions=True
                    )
                continue

            if msg_type == "upload_cancelled":
                upload_id = message_data.get("upload_id")
                if upload_id:
                    logger.info(f"Chat WS: User {user_id} cancelled upload {upload_id}")
                    # 1. Удаляем сессию загрузки
                    session_stmt = select(FileUploadSession).where(FileUploadSession.id == upload_id)
                    res_session = await db.execute(session_stmt)
                    session = res_session.scalar_one_or_none()
                    
                    if session and session.user_id == user_id:
                        # Удаляем временный файл
                        root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
                        temp_dir = os.path.join(root_dir, "media", "temp")
                        file_path = os.path.join(temp_dir, f"{upload_id}_{session.filename}")
                        if os.path.exists(file_path):
                            try:
                                os.remove(file_path)
                            except Exception as e:
                                logger.error(f"Failed to delete temp file on upload cancel: {e}")
                                
                        await db.delete(session)
                    
                    # 2. Ищем placeholder сообщение
                    msg_stmt = select(ChatMessage).where(
                        ChatMessage.upload_id == upload_id,
                        ChatMessage.sender_id == user_id
                    )
                    res_msg = await db.execute(msg_stmt)
                    ph_msg = res_msg.scalar_one_or_none()
                    
                    if ph_msg:
                        msg_id = ph_msg.id
                        receiver_id = ph_msg.receiver_id
                        await db.delete(ph_msg)
                        await db.commit()
                        
                        # Уведомляем обоих участников об удалении сообщения
                        delete_event = {
                            "type": "message_deleted",
                            "data": {
                                "message_id": msg_id,
                                "upload_id": upload_id
                            }
                        }
                        await asyncio.gather(
                            manager.send_personal_message(delete_event, user_id),
                            manager.send_personal_message(delete_event, receiver_id),
                            notifications_manager.send_personal_message(delete_event, user_id),
                            notifications_manager.send_personal_message(delete_event, receiver_id),
                            return_exceptions=True
                        )
                    else:
                        await db.commit()
                continue

            # Стандартная отправка сообщения
            receiver_id_raw = message_data.get("receiver_id")
            content = message_data.get("message")
            file_path = message_data.get("file_path")
            attachments = message_data.get("attachments")  # список объектов {file_path, type}
            message_type = message_data.get("message_type", "text")
            client_id = message_data.get("client_id")  # Добавлено для оптимистичных обновлений
            duration = message_data.get("duration") # Длительность аудио/видео
            reply_to_id = message_data.get("reply_to_id")
            
            if receiver_id_raw and (content or file_path or (attachments and len(attachments) > 0)):
                # Приводим к int для корректного поиска в менеджерах соединений
                try:
                    receiver_id = int(receiver_id_raw)
                except (ValueError, TypeError):
                    logger.warning(f"Invalid receiver_id format: {receiver_id_raw}")
                    continue
                
                # Если пришли вложения списком — считаем это медиа-группой и сохраняем
                if attachments and len(attachments) > 0:
                    message_type = "media_group"
                    # Сохраняем вложения как JSON-строку в file_path для совместимости БД
                    try:
                        file_path = json.dumps(attachments)
                    except Exception as e:
                        logger.error(f"Failed to serialize attachments: {e}")
                        file_path = None
                
                logger.debug(f"Saving message: type={message_type}, sender={user_id}, receiver={receiver_id}")
                
                # Ищем placeholder, если есть client_id
                existing_msg = None
                if client_id:
                    # Ищем любые сообщения с этим client_id, которые являются плейсхолдерами (is_uploading или имеют upload_id)
                    # Ограничиваем временем (24 часа), чтобы не задеть старые сообщения при повторе client_id
                    time_limit = datetime.utcnow() - timedelta(hours=24)
                    res_existing = await db.execute(
                        select(ChatMessage).where(
                            ChatMessage.client_id == client_id,
                            ChatMessage.sender_id == user_id,
                            or_(
                                ChatMessage.is_uploading == True,
                                ChatMessage.upload_id.isnot(None)
                            ),
                            ChatMessage.timestamp >= time_limit
                        )
                    )
                    # Если было несколько плейсхолдеров (например, для разных файлов в группе), берем первый для обновления, остальные удалим
                    existing_msgs = res_existing.scalars().all()
                    if existing_msgs:
                        existing_msg = existing_msgs[0]
                        if len(existing_msgs) > 1:
                            for extra_ph in existing_msgs[1:]:
                                await db.delete(extra_ph)
                            logger.debug(f"Removed {len(existing_msgs) - 1} extra placeholders for client_id {client_id}")

                if existing_msg:
                    # Обновляем существующий placeholder
                    logger.debug(f"Updating existing placeholder message {existing_msg.id} with client_id {client_id}")
                    existing_msg.message = content
                    existing_msg.file_path = file_path
                    existing_msg.message_type = message_type
                    existing_msg.duration = duration
                    existing_msg.reply_to_id = reply_to_id
                    existing_msg.is_uploading = False
                    existing_msg.upload_id = None
                    existing_msg.timestamp = datetime.utcnow()
                    new_msg = existing_msg
                else:
                    # Сохраняем в базу новое сообщение
                    new_msg = ChatMessage(
                        sender_id=user_id,
                        receiver_id=receiver_id,
                        message=content,
                        file_path=file_path,
                        message_type=message_type,
                        client_id=client_id,
                        duration=duration,
                        reply_to_id=reply_to_id
                    )
                    db.add(new_msg)
                
                await db.commit()
                await db.refresh(new_msg)

                # Готовим данные отвечаемого сообщения, если оно есть
                reply_to_data = None
                if reply_to_id:
                    try:
                        reply_res = await db.execute(
                            select(ChatMessage, UserModel.first_name, UserModel.last_name)
                            .join(UserModel, ChatMessage.sender_id == UserModel.id)
                            .where(ChatMessage.id == reply_to_id)
                        )
                        reply_row = reply_res.first()
                        if reply_row:
                            r_msg, r_fname, r_lname = reply_row
                            reply_to_data = {
                                "id": r_msg.id,
                                "message": r_msg.message,
                                "message_type": r_msg.message_type,
                                "sender_id": r_msg.sender_id,
                                "sender_name": f"{r_fname} {r_lname}".strip() or "Пользователь"
                            }
                    except Exception as e:
                        logger.error(f"Error fetching reply_to message: {e}")

                # sender_name is already fetched once above the loop

                # Готовим данные ответа
                response_data = {
                    "id": new_msg.id,
                    "client_id": client_id,  # Возвращаем client_id для фронтенда
                    "sender_id": user_id,
                    "sender_name": sender_name,
                    "receiver_id": receiver_id,
                    "message": content,
                    "file_path": file_path,
                    "message_type": message_type,
                    "duration": duration,
                    "reply_to_id": reply_to_id,
                    "reply_to": reply_to_data,
                    "timestamp": new_msg.timestamp.isoformat(),
                    "is_read": 0
                }
                # В ответ добавляем attachments как список, если это media_group
                if message_type == "media_group":
                    try:
                        response_data["attachments"] = attachments or json.loads(file_path or "[]")
                    except Exception:
                        response_data["attachments"] = []
                
                # Рассылаем сообщения всем участникам параллельно для минимальной задержки
                chat_event = {
                    "type": "new_message",
                    "data": response_data
                }
                await asyncio.gather(
                    manager.send_personal_message(chat_event, receiver_id),
                    manager.send_personal_message(chat_event, user_id),
                    notifications_manager.send_personal_message(chat_event, receiver_id),
                    notifications_manager.send_personal_message(chat_event, user_id),
                    return_exceptions=True
                )

                # Отправляем Пуш через FCM, если получатель не подключен к WebSocket
                # Находим получателя, чтобы взять его fcm_token
                # Используем populate_existing=True, чтобы избежать старых данных в долгоживущих сессиях (WebSocket)
                receiver = await db.get(UserModel, receiver_id, populate_existing=True)
                
                if receiver and receiver.fcm_token:
                    def format_duration(seconds):
                        if seconds is None: return ""
                        minutes = int(seconds // 60)
                        remaining_seconds = int(seconds % 60)
                        return f" ({minutes}:{remaining_seconds:02d})"

                    if message_type == "video_note":
                        body = f"📹 Видеосообщение{format_duration(duration)}"
                    elif message_type == "audio":
                        body = f"🎤 Голосовое сообщение{format_duration(duration)}"
                    elif message_type == "image":
                        body = "🖼️ Фотография"
                    elif message_type == "file":
                        body = "📁 Файл"
                    else:
                        body = content if content else f"Отправил {message_type}"
                    
                    logger.info(f"FCM: Triggering notification for receiver {receiver_id} with token {receiver.fcm_token}")
                    asyncio.create_task(send_fcm_notification(
                        token=receiver.fcm_token,
                        title=sender_name,
                        body=body,
                        sender_id=user_id,
                        sender_avatar=sender_avatar,
                        data={
                            "chat_id": str(user_id),
                            "message_id": str(new_msg.id)
                        }
                    ))
                else:
                    logger.debug(f"FCM: Skipping notification for receiver {receiver_id}. No token found.")
            else:
                logger.debug(f"Message skipped. receiver_id={receiver_id_raw}, content={bool(content)}, file_path={bool(file_path)}")

    except WebSocketDisconnect:
        logger.info(f"Chat WS disconnected for user {user_id}")
        manager.disconnect(websocket, user_id)
    except Exception as e:
        logger.error(f"Error in chat WS for user {user_id}: {e}")
        manager.disconnect(websocket, user_id)

@router.post("/message", response_model=ChatMessageResponse)
async def send_message_api(
    msg_in: ChatMessageCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    user_id = current_user.id
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    receiver_id = msg_in.receiver_id
    content = msg_in.message
    file_path = msg_in.file_path
    attachments = msg_in.attachments
    message_type = msg_in.message_type
    client_id = msg_in.client_id  # Добавлено для оптимистичных обновлений
    duration = msg_in.duration # Длительность аудио/видео
    
    if attachments and len(attachments) > 0:
        message_type = "media_group"
        try:
            file_path = json.dumps(attachments)
        except Exception:
            file_path = None
    
    # Сохраняем в базу
    client_id = msg_in.client_id
    
    new_msg = ChatMessage(
        sender_id=user_id,
        receiver_id=receiver_id,
        message=content,
        file_path=file_path,
        message_type=message_type,
        client_id=client_id,
        duration=duration
    )
    db.add(new_msg)
    await db.commit()
    await db.refresh(new_msg)

    # Находим отправителя для имени и аватарки
    sender_result = await db.execute(select(UserModel.first_name, UserModel.last_name, UserModel.avatar_url).where(UserModel.id == user_id))
    sender_row = sender_result.first()
    sender_name = f"{sender_row.first_name} {sender_row.last_name}".strip() if sender_row and (sender_row.first_name or sender_row.last_name) else "Пользователь"
    if not sender_name: sender_name = "Пользователь"
    sender_avatar = sender_row.avatar_url if sender_row else None

    # Готовим данные ответа
    response_data = {
        "id": new_msg.id,
        "client_id": client_id,  # Возвращаем client_id
        "sender_id": user_id,
        "sender_name": sender_name,
        "receiver_id": receiver_id,
        "message": content,
        "file_path": file_path,
        "message_type": message_type,
        "duration": duration,
        "timestamp": new_msg.timestamp.isoformat() if hasattr(new_msg.timestamp, 'isoformat') else new_msg.timestamp,
        "is_read": 0
    }
    if message_type == "media_group":
        try:
            response_data["attachments"] = attachments or json.loads(file_path or "[]")
        except Exception:
            response_data["attachments"] = []

    # Уведомляем всех параллельно
    chat_event = {
        "type": "new_message",
        "data": response_data
    }
    await asyncio.gather(
        manager.send_personal_message(chat_event, receiver_id),
        manager.send_personal_message(chat_event, user_id),
        notifications_manager.send_personal_message(chat_event, receiver_id),
        notifications_manager.send_personal_message(chat_event, user_id),
        return_exceptions=True
    )

    # FCM Notification
    # Используем populate_existing=True, чтобы получить актуальный токен из БД
    receiver = await db.get(UserModel, receiver_id, populate_existing=True)
    
    if receiver and receiver.fcm_token:
        def format_duration(seconds):
            if seconds is None: return ""
            minutes = int(seconds // 60)
            remaining_seconds = int(seconds % 60)
            return f" ({minutes}:{remaining_seconds:02d})"

        if message_type == "video_note":
            body = f"📹 Видеосообщение{format_duration(duration)}"
        elif message_type == "audio":
            body = f"🎤 Голосовое сообщение{format_duration(duration)}"
        elif message_type == "image":
            body = "🖼️ Фотография"
        elif message_type == "file":
            body = "📁 Файл"
        else:
            body = content if content else f"Отправил {message_type}"
        
        logger.info(f"FCM (API): Triggering notification for receiver {receiver_id} with token {receiver.fcm_token[:15]}...")
        asyncio.create_task(send_fcm_notification(
            token=receiver.fcm_token,
            title=sender_name,
            body=body,
            sender_id=user_id,
            sender_avatar=sender_avatar,
            data={
                "chat_id": str(user_id),
                "message_id": str(new_msg.id)
            }
        ))
    else:
        logger.debug(f"FCM (API): Skipping notification for receiver {receiver_id}. No token found.")

    return response_data

@router.get("/history/{other_user_id}", response_model=List[ChatMessageResponse])
async def get_chat_history(
    other_user_id: int,
    limit: int = 15,
    skip: int = 0,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    user_id = current_user.id
    if user_id is None:
        return []

    result = await db.execute(
        select(ChatMessage)
        .options(joinedload(ChatMessage.reply_to).joinedload(ChatMessage.sender))
        .where(
            or_(
                and_(ChatMessage.sender_id == user_id, ChatMessage.receiver_id == other_user_id, ChatMessage.deleted_by_sender == False),
                and_(ChatMessage.sender_id == other_user_id, ChatMessage.receiver_id == user_id, ChatMessage.deleted_by_receiver == False)
            )
        )
        # Исключаем плейсхолдеры, которые висят слишком долго (вероятно, загрузка прервана)
        .where(
            or_(
                ChatMessage.is_uploading == False,
                ChatMessage.timestamp >= datetime.utcnow() - timedelta(hours=1)
            )
        )
        .order_by(ChatMessage.timestamp.desc())
        .offset(skip)
        .limit(limit)
    )
    db_messages = result.scalars().all()

    # Преобразуем в словари и добавим attachments для media_group
    messages = []
    for m in db_messages:
        item = {
            "id": m.id,
            "sender_id": m.sender_id,
            "receiver_id": m.receiver_id,
            "message": m.message,
            "file_path": m.file_path,
            "message_type": m.message_type,
            "client_id": m.client_id,
            "duration": m.duration,
            "timestamp": m.timestamp,
            "is_read": m.is_read,
            "reply_to_id": m.reply_to_id,
            "is_uploading": getattr(m, 'is_uploading', False),
            "upload_id": getattr(m, 'upload_id', None),
        }
        
        if m.reply_to:
            r = m.reply_to
            r_sender = r.sender
            item["reply_to"] = {
                "id": r.id,
                "message": r.message,
                "message_type": r.message_type,
                "sender_id": r.sender_id,
                "sender_name": f"{r_sender.first_name} {r_sender.last_name}".strip() or "Пользователь" if r_sender else "Пользователь"
            }
        else:
            item["reply_to"] = None
        if m.message_type == "media_group" and m.file_path:
            try:
                item["attachments"] = json.loads(m.file_path)
            except Exception:
                item["attachments"] = []
        messages.append(item)

    # Дедупликация по client_id (схлопываем плейсхолдеры и готовые сообщения в истории)
    # Это предотвращает отображение дубликатов, если плейсхолдер не был удален вовремя
    unique_messages = []
    seen_client_ids = {} # client_id -> index in unique_messages
    
    for item in messages:
        cid = item.get("client_id")
        if cid:
            if cid in seen_client_ids:
                idx = seen_client_ids[cid]
                existing = unique_messages[idx]
                # Если текущее сообщение (item) более "полноценное" (не в процессе загрузки), 
                # а ранее встреченное (existing) было плейсхолдером — заменяем его.
                # Обычно первое встреченное в истории (DESC) — самое новое.
                if existing.get("is_uploading") and not item.get("is_uploading"):
                    unique_messages[idx] = item
                continue
            seen_client_ids[cid] = len(unique_messages)
        unique_messages.append(item)

    # Возвращаем в обратном хронологическом порядке для FlatList inverted
    return unique_messages

@router.get("/dialogs", response_model=List[DialogResponse])
async def get_dialogs(
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    user_id = current_user.id
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token")

    # Находим всех собеседников, с которыми есть активные (не удаленные) сообщения
    # Сначала те, кому мы писали
    sent_to = select(ChatMessage.receiver_id).where(
        ChatMessage.sender_id == user_id, 
        ChatMessage.deleted_by_sender == False
    )
    # Потом те, кто нам писал
    received_from = select(ChatMessage.sender_id).where(
        ChatMessage.receiver_id == user_id, 
        ChatMessage.deleted_by_receiver == False
    )
    
    # Объединяем id собеседников и убираем дубликаты
    partners_query = sent_to.union(received_from)
    partners_result = await db.execute(partners_query)
    # Используем set для уникальности, на случай если union не сработал как DISTINCT
    partner_ids = list(set(partners_result.scalars().all()))

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
            )
            .where(
                or_(
                    ChatMessage.is_uploading == False,
                    ChatMessage.timestamp >= datetime.utcnow() - timedelta(hours=1)
                )
            )
            .order_by(ChatMessage.timestamp.desc()).limit(1)
        )
        last_msg = last_msg_res.scalar_one_or_none()
        if not last_msg: continue # Если нет видимых сообщений, не показываем диалог
        
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
            "avatar_url": getattr(partner, 'avatar_url', None), 
            "last_message": last_msg.message if last_msg and last_msg.message else "[Файл]",
            "last_message_time": last_msg.timestamp if last_msg and last_msg.timestamp else datetime.utcnow(),
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
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    user_id = current_user.id
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token")

    await db.execute(
        update(ChatMessage)
        .where(
            ChatMessage.sender_id == other_user_id,
            ChatMessage.receiver_id == user_id,
            ChatMessage.is_read == 0,
            ChatMessage.deleted_by_receiver == False
        )
        .values(is_read=1)
    )
    await db.commit()

    # Уведомляем пользователя об обновлении счетчиков
    await notifications_manager.send_personal_message({
        "type": "messages_read",
        "data": {"from_user_id": other_user_id}
    }, user_id)

    # Уведомляем отправителя о том, что его сообщения прочитаны
    await notifications_manager.send_personal_message({
        "type": "your_messages_read",
        "data": {"reader_id": user_id}
    }, other_user_id)
    
    await manager.send_personal_message({
        "type": "messages_read",
        "reader_id": user_id
    }, other_user_id)

    return {"status": "ok"}

@router.delete("/message/{message_id}")
async def delete_message(
    message_id: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    user_id = current_user.id
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
        # Soft delete для обоих сторон (удаление "для всех")
        message.deleted_by_sender = True
        message.deleted_by_receiver = True
        logger.info(f"API: Message {message_id} soft-deleted for all by sender {user_id}")
    else:
        # Удаление только для себя (получателя)
        message.deleted_by_receiver = True
        logger.info(f"API: Message {message_id} soft-deleted for receiver {user_id}")
    
    await db.commit()

    # Если удаляет отправитель ("для всех") и есть файл — удаляем его физически
    if is_sender and file_path:
        try:
            # Очищаем контент
            message.message = "[Сообщение удалено]"
            message.file_path = None
            await db.commit()

            root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            if message.message_type == "media_group":
                try:
                    attachments = json.loads(file_path)
                    for att in attachments:
                        att_path = att.get("file_path")
                        if att_path:
                            abs_path = os.path.join(root_dir, att_path.lstrip("/"))
                            if os.path.exists(abs_path):
                                os.remove(abs_path)
                except: pass
            else:
                abs_path = os.path.join(root_dir, file_path.lstrip("/"))
                if os.path.exists(abs_path):
                    os.remove(abs_path)
        except Exception as e:
            logger.error(f"Error deleting chat file: {e}")

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
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    user_id = current_user.id
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
            # Soft delete для всех
            msg.deleted_by_sender = True
            msg.deleted_by_receiver = True
            # Удаляем файлы
            if file_path:
                try:
                    msg.message = "[Сообщение удалено]"
                    msg.file_path = None
                    # Если это JSON список (media_group), удаляем все файлы
                    if msg.message_type == "media_group":
                        try:
                            attachments = json.loads(file_path)
                            for att in attachments:
                                att_path = att.get("file_path")
                                if att_path:
                                    abs_path = os.path.join(root_dir, att_path.lstrip("/"))
                                    if os.path.exists(abs_path):
                                        os.remove(abs_path)
                        except: pass
                    else:
                        abs_path = os.path.join(root_dir, file_path.lstrip("/"))
                        if os.path.exists(abs_path):
                            os.remove(abs_path)
                except Exception as e:
                    logger.error(f"Error deleting chat file: {e}")
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
):
    # В реальном приложении здесь должна быть проверка токена
    file_extension = os.path.splitext(file.filename or "")[1]
    content = await file.read()

    # Определяем тип сообщения на основе расширения
    message_type = "file"
    file_extension_lower = file_extension.lower()
    content_type = file.content_type or "application/octet-stream"
    
    # Если это PDF, принудительно ставим правильный mime-type, если он не пришел
    if file_extension_lower == ".pdf":
        content_type = "application/pdf"

    if file_extension_lower in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
        message_type = "image"
    elif file_extension_lower in [".mp4", ".webm", ".ogg"]:
        message_type = "video"
    elif file_extension_lower in [".m4a", ".mp3", ".wav", ".aac", ".amr", ".3gp"]:
        message_type = "voice"

    # Сохраняем оригинал через абстракцию хранилища
    base_name = str(uuid.uuid4())
    original_url, _ = storage.save_file(
        category="chat",
        filename_hint=f"{base_name}{file_extension or ''}",
        fileobj=io.BytesIO(content),
        content_type=content_type,
        private=False,
    )

    # Если это изображение — создаем миниатюру (необязательно возвращать)
    if message_type == "image":
        try:
            with Image.open(io.BytesIO(content)) as img:
                img.thumbnail((200, 200))
                thumb_buffer = io.BytesIO()
                fmt = "JPEG" if file_extension_lower in [".jpg", ".jpeg"] else None
                img.save(thumb_buffer, format=fmt)
                thumb_buffer.seek(0)
                _thumb_url, _ = storage.save_file(
                    category="chat",
                    filename_hint=f"{base_name}_thumb{file_extension or ''}",
                    fileobj=thumb_buffer,
                    content_type=file.content_type or "image/jpeg",
                    private=False,
                )
        except Exception:
            pass

    return {"file_path": original_url, "message_type": message_type}

@router.post("/upload/init", response_model=UploadSessionResponse)
async def init_upload(
    req: UploadInitRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    try:
        user_id = current_user.id
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
        logger.error(f"Error in init_upload: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/upload/active", response_model=List[dict])
async def get_active_uploads(
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    user_id = current_user.id
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token")
        
    res = await db.execute(select(FileUploadSession).where(
        FileUploadSession.user_id == user_id,
        FileUploadSession.is_completed == False
    ).order_by(FileUploadSession.created_at.desc()))
    sessions = res.scalars().all()
    
    return [
        {
            "upload_id": s.id,
            "filename": s.filename,
            "file_size": s.file_size,
            "offset": s.offset,
            "mime_type": s.mime_type,
            "created_at": s.created_at.isoformat()
        } for s in sessions
    ]

@router.get("/upload/status/{upload_id}", response_model=UploadStatusResponse)
async def get_upload_status(
    upload_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    user_id = current_user.id
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

@router.post("/upload/cancel/{upload_id}")
async def cancel_upload_api(
    upload_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    user_id = current_user.id
    logger.info(f"Chat API: User {user_id} cancelled upload {upload_id}")
    
    # 1. Удаляем сессию загрузки
    session_stmt = select(FileUploadSession).where(FileUploadSession.id == upload_id)
    res_session = await db.execute(session_stmt)
    session = res_session.scalar_one_or_none()
    
    if session and session.user_id == user_id:
        # Удаляем временный файл
        root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        temp_dir = os.path.join(root_dir, "media", "temp")
        file_path = os.path.join(temp_dir, f"{upload_id}_{session.filename}")
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception as e:
                logger.error(f"Failed to delete temp file on upload cancel: {e}")
                
        await db.delete(session)
    
    # 2. Ищем placeholder сообщение
    msg_stmt = select(ChatMessage).where(
        ChatMessage.upload_id == upload_id,
        ChatMessage.sender_id == user_id
    )
    res_msg = await db.execute(msg_stmt)
    ph_msg = res_msg.scalar_one_or_none()
    
    if ph_msg:
        msg_id = ph_msg.id
        receiver_id = ph_msg.receiver_id
        await db.delete(ph_msg)
        await db.commit()
        
        # Уведомляем участников через WebSocket
        delete_event = {
            "type": "message_deleted",
            "data": {
                "message_id": msg_id,
                "upload_id": upload_id
            }
        }
        await asyncio.gather(
            manager.send_personal_message(delete_event, user_id),
            manager.send_personal_message(delete_event, receiver_id),
            notifications_manager.send_personal_message(delete_event, user_id),
            notifications_manager.send_personal_message(delete_event, receiver_id),
            return_exceptions=True
        )
    else:
        await db.commit()
        
    return {"status": "ok", "message": "Upload cancelled"}

@router.post("/upload/chunk/{upload_id}")
async def upload_chunk(
    upload_id: str,
    offset: Optional[int] = Form(None),
    q_offset: Optional[int] = Query(None),
    q_token: Optional[str] = Query(None),
    chunk: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_async_db),
    current_user: Optional[UserModel] = Depends(get_current_user_optional)
):
    logger.debug(f"upload_chunk called for {upload_id}")
    
    # Пытаемся получить пользователя из q_token, если он не был получен из заголовка (Depends)
    if not current_user and q_token:
        current_user = await get_user_from_token(q_token, db)
        
    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user_id = current_user.id
    actual_offset = offset if offset is not None else q_offset

    if actual_offset is None:
        logger.debug("Missing offset")
        raise HTTPException(status_code=422, detail="Missing offset")
        
    if chunk is None:
        logger.debug("Missing chunk file")
        # Log all fields for debugging
        return {"status": "error", "message": "Missing chunk", "debug_received_params": {
            "offset": offset, "q_offset": q_offset
        }}

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

    # Отправляем прогресс по WebSocket, если есть placeholder-сообщение
    try:
        res_msg = await db.execute(
            select(ChatMessage).where(
                ChatMessage.upload_id == upload_id,
                ChatMessage.sender_id == user_id
            )
        )
        ph_msg = res_msg.scalar_one_or_none()
        if ph_msg:
            progress_payload = {
                "type": "upload_progress",
                "data": {
                    "upload_id": upload_id,
                    "message_id": ph_msg.id,
                    "offset": session.offset,
                    "total": session.file_size,
                    "progress": float(session.offset) / float(session.file_size) if session.file_size else 0.0
                }
            }
            await asyncio.gather(
                manager.send_personal_message(progress_payload, user_id),
                manager.send_personal_message(progress_payload, ph_msg.receiver_id),
                return_exceptions=True
            )
    except Exception as e:
        logger.error(f"upload_progress send failed: {e}")
    
    if session.offset >= session.file_size:
        session.is_completed = True
        session.offset = session.file_size
        # Загружаем собранный файл в постоянное хранилище (S3/локально)
        file_extension = os.path.splitext(session.filename)[1]
        
        # Определяем тип (по аналогии с обычным upload)
        message_type = "file"
        final_content_type = session.mime_type or "application/octet-stream"
        
        if file_extension.lower() == ".pdf":
            final_content_type = "application/pdf"

        if file_extension.lower() in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
            message_type = "image"
        elif file_extension.lower() in [".mp4", ".webm", ".ogg"]:
            message_type = "video"
        elif file_extension.lower() in [".m4a", ".mp3", ".wav", ".aac", ".amr", ".3gp"]:
            message_type = "voice"
            
        unique_name = f"{uuid.uuid4()}{file_extension}"
        with open(file_path, "rb") as f_in:
            url, _ = storage.save_file(
                category="chat",
                filename_hint=unique_name,
                fileobj=f_in,
                content_type=final_content_type,
                private=False,
            )
        try:
            os.remove(file_path)
        except Exception:
            pass
            
        # Пытаемся обновить placeholder-сообщение и отправить событие обновления
        try:
            res_msg2 = await db.execute(
                select(ChatMessage).where(
                    ChatMessage.upload_id == upload_id,
                    ChatMessage.sender_id == user_id
                )
            )
            upd_msg = res_msg2.scalar_one_or_none()
            if upd_msg:
                upd_msg.file_path = url
                upd_msg.message_type = message_type
                upd_msg.is_uploading = False
                await db.commit()
                update_event = {"type": "message_updated", "data": {
                    "id": upd_msg.id,
                    "file_path": url,
                    "message_type": message_type,
                    "is_uploading": False,
                    "upload_id": upload_id
                }}
                await asyncio.gather(
                    manager.send_personal_message(update_event, user_id),
                    manager.send_personal_message(update_event, upd_msg.receiver_id),
                    notifications_manager.send_personal_message(update_event, upd_msg.receiver_id),
                    notifications_manager.send_personal_message(update_event, user_id),
                    return_exceptions=True
                )
        except Exception as e:
            logger.error(f"message_updated send failed: {e}")
            await db.rollback()
        
        await db.commit()
        return {
            "status": "completed",
            "file_path": url,
            "message_type": message_type
        }
    
    await db.commit()
    return {"status": "ok", "offset": session.offset}
