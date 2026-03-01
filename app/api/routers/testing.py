from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, and_, or_
import asyncio
from app.api.dependencies import get_async_db
from app.api.routers.chat import manager as chat_manager
from app.api.routers.notifications import manager as notifications_manager
from app.core.fcm import send_fcm_notification
from app.models.users import User as UserModel
from app.models.chat import ChatMessage
from app.schemas.chat import ChatMessageCreate, ChatMessageResponse
from typing import List, Optional
from datetime import datetime

router = APIRouter(prefix="/test/chat", tags=["Testing Chat"])

@router.post("/send_as", response_model=ChatMessageResponse)
async def send_message_as_user(
    sender_id: int, 
    msg_in: ChatMessageCreate, 
    db: AsyncSession = Depends(get_async_db)
):
    """
    Отправить сообщение от любого пользователя любому пользователю (для тестирования).
    """
    new_msg = ChatMessage(
        sender_id=sender_id,
        receiver_id=msg_in.receiver_id,
        message=msg_in.message,
        file_path=msg_in.file_path,
        message_type=msg_in.message_type,
        client_id=msg_in.client_id,
        duration=msg_in.duration,
        timestamp=datetime.utcnow(),
        is_read=0
    )
    db.add(new_msg)
    await db.commit()
    await db.refresh(new_msg)
    
    # Пытаемся получить имя отправителя и аватарку
    res = await db.execute(select(UserModel.first_name, UserModel.last_name, UserModel.avatar_url).where(UserModel.id == sender_id))
    user_info = res.fetchone()
    sender_name = f"{user_info.first_name} {user_info.last_name}" if user_info else f"User {sender_id}"
    sender_avatar = user_info.avatar_url if user_info else None

    # Подготовка ответа
    resp_msg = ChatMessageResponse(
        id=new_msg.id,
        sender_id=new_msg.sender_id,
        receiver_id=new_msg.receiver_id,
        message=new_msg.message,
        file_path=new_msg.file_path,
        message_type=new_msg.message_type,
        client_id=new_msg.client_id,
        duration=new_msg.duration,
        timestamp=new_msg.timestamp,
        is_read=new_msg.is_read,
        sender_name=sender_name
    )

    # Отправка через WebSocket (если подключен)
    await chat_manager.send_personal_message(resp_msg.model_dump(mode="json"), new_msg.receiver_id)
    
    # Также уведомление через notifications_manager
    await notifications_manager.send_personal_message({
        "type": "new_message",
        "data": resp_msg.model_dump(mode="json")
    }, user_id=new_msg.receiver_id)

    # Push-уведомление через FCM (для тестирования доставки)
    receiver = await db.get(UserModel, new_msg.receiver_id, populate_existing=True)
    if receiver and receiver.fcm_token:
        def format_duration(seconds):
            if seconds is None: return ""
            minutes = int(seconds // 60)
            remaining_seconds = int(seconds % 60)
            return f" ({minutes}:{remaining_seconds:02d})"

        if new_msg.message_type == "video_note":
            body = f"📹 Видеосообщение{format_duration(new_msg.duration)}"
        elif new_msg.message_type == "audio":
            body = f"🎤 Голосовое сообщение{format_duration(new_msg.duration)}"
        else:
            body = new_msg.message if new_msg.message else f"Тестовое сообщение ({new_msg.message_type})"
            
        # Используем create_task чтобы не блокировать ответ API
        asyncio.create_task(send_fcm_notification(
            token=receiver.fcm_token,
            title=f"[TEST] {sender_name}",
            body=body,
            sender_id=sender_id,
            sender_avatar=sender_avatar,
            data={
                "chat_id": str(sender_id),
                "message_id": str(new_msg.id),
                "type": "new_message",
                "is_test": "true"
            }
        ))

    return resp_msg

@router.get("/history", response_model=List[ChatMessageResponse])
async def get_test_history(
    user1_id: int, 
    user2_id: int, 
    limit: int = 50, 
    db: AsyncSession = Depends(get_async_db)
):
    """
    Получить историю сообщений между двумя пользователями без авторизации.
    """
    query = select(ChatMessage).where(
        or_(
            and_(ChatMessage.sender_id == user1_id, ChatMessage.receiver_id == user2_id),
            and_(ChatMessage.sender_id == user2_id, ChatMessage.receiver_id == user1_id)
        )
    ).order_by(ChatMessage.timestamp.desc()).limit(limit)
    
    result = await db.execute(query)
    messages = result.scalars().all()
    
    # Получаем имена отправителей
    user_ids = list(set([m.sender_id for m in messages]))
    user_res = await db.execute(select(UserModel.id, UserModel.first_name, UserModel.last_name).where(UserModel.id.in_(user_ids)))
    user_map = {u.id: f"{u.first_name} {u.last_name}" for u in user_res.fetchall()}

    return [
        ChatMessageResponse(
            id=m.id,
            sender_id=m.sender_id,
            receiver_id=m.receiver_id,
            message=m.message,
            file_path=m.file_path,
            message_type=m.message_type,
            client_id=m.client_id,
            duration=m.duration,
            timestamp=m.timestamp,
            is_read=m.is_read,
            sender_name=user_map.get(m.sender_id, f"User {m.sender_id}")
        ) for m in messages
    ]

@router.delete("/clear")
async def clear_test_chat(
    user1_id: int, 
    user2_id: int, 
    db: AsyncSession = Depends(get_async_db)
):
    """
    Удалить все сообщения между двумя пользователями.
    """
    stmt = delete(ChatMessage).where(
        or_(
            and_(ChatMessage.sender_id == user1_id, ChatMessage.receiver_id == user2_id),
            and_(ChatMessage.sender_id == user2_id, ChatMessage.receiver_id == user1_id)
        )
    )
    await db.execute(stmt)
    await db.commit()
    return {"status": "success", "message": f"Chat between {user1_id} and {user2_id} cleared"}

@router.get("/last_messages", response_model=List[ChatMessageResponse])
async def get_last_messages(
    limit: int = 20, 
    db: AsyncSession = Depends(get_async_db)
):
    """
    Получить последние сообщения во всей системе (для отладки).
    """
    query = select(ChatMessage).order_by(ChatMessage.timestamp.desc()).limit(limit)
    result = await db.execute(query)
    messages = result.scalars().all()
    
    # Получаем имена отправителей
    user_ids = list(set([m.sender_id for m in messages]))
    user_res = await db.execute(select(UserModel.id, UserModel.first_name, UserModel.last_name).where(UserModel.id.in_(user_ids)))
    user_map = {u.id: f"{u.first_name} {u.last_name}" for u in user_res.fetchall()}

    return [
        ChatMessageResponse(
            id=m.id,
            sender_id=m.sender_id,
            receiver_id=m.receiver_id,
            message=m.message,
            file_path=m.file_path,
            message_type=m.message_type,
            client_id=m.client_id,
            duration=m.duration,
            timestamp=m.timestamp,
            is_read=m.is_read,
            sender_name=user_map.get(m.sender_id, f"User {m.sender_id}")
        ) for m in messages
    ]
