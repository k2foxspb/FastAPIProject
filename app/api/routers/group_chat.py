from typing import List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, and_

from app.api.dependencies import get_async_db
from app.models.chat import GroupChat, GroupChatMember, ChatMessage
from app.models.users import User as UserModel
from app.schemas.chat import (
    GroupChatCreate, GroupChatUpdate, AddGroupMembersRequest,
    GroupChatResponse, GroupChatDetailResponse, GroupChatMemberResponse
)
from app.core.auth import get_current_user
from loguru import logger

router = APIRouter(prefix="/chat/groups", tags=["group_chat"])


def _format_name(user: UserModel) -> str:
    name = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return name or "Пользователь"


async def _get_membership(db: AsyncSession, group_id: int, user_id: int) -> GroupChatMember | None:
    result = await db.execute(
        select(GroupChatMember).where(
            GroupChatMember.group_id == group_id,
            GroupChatMember.user_id == user_id
        )
    )
    return result.scalar_one_or_none()


async def _require_membership(db: AsyncSession, group_id: int, user_id: int) -> GroupChatMember:
    membership = await _get_membership(db, group_id, user_id)
    if not membership:
        raise HTTPException(status_code=403, detail="Вы не являетесь участником этой группы")
    return membership


async def _require_admin_or_owner(db: AsyncSession, group_id: int, user_id: int) -> GroupChatMember:
    membership = await _require_membership(db, group_id, user_id)
    if membership.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Недостаточно прав (нужны права администратора)")
    return membership


@router.post("", response_model=GroupChatDetailResponse)
async def create_group(
    payload: GroupChatCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    if not payload.name or not payload.name.strip():
        raise HTTPException(status_code=400, detail="Название группы не может быть пустым")

    group = GroupChat(name=payload.name.strip(), avatar_url=payload.avatar_url, owner_id=current_user.id)
    db.add(group)
    await db.flush()

    db.add(GroupChatMember(group_id=group.id, user_id=current_user.id, role="owner"))

    unique_member_ids = {mid for mid in (payload.member_ids or []) if mid != current_user.id}
    if unique_member_ids:
        result = await db.execute(select(UserModel.id).where(UserModel.id.in_(unique_member_ids)))
        valid_ids = {row[0] for row in result.all()}
        for uid in valid_ids:
            db.add(GroupChatMember(group_id=group.id, user_id=uid, role="member"))

    await db.commit()

    return await get_group_detail(group.id, db=db, current_user=current_user)


@router.get("", response_model=List[GroupChatResponse])
async def list_my_groups(
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    result = await db.execute(
        select(GroupChat, GroupChatMember.role)
        .join(GroupChatMember, GroupChatMember.group_id == GroupChat.id)
        .where(GroupChatMember.user_id == current_user.id)
    )
    rows = result.all()

    groups_data = []
    for group, my_role in rows:
        members_count_res = await db.execute(
            select(func.count(GroupChatMember.id)).where(GroupChatMember.group_id == group.id)
        )
        members_count = members_count_res.scalar() or 0

        last_msg_res = await db.execute(
            select(ChatMessage).where(ChatMessage.group_id == group.id)
            .order_by(ChatMessage.timestamp.desc()).limit(1)
        )
        last_msg = last_msg_res.scalar_one_or_none()

        groups_data.append(GroupChatResponse(
            id=group.id,
            name=group.name,
            avatar_url=group.avatar_url,
            owner_id=group.owner_id,
            my_role=my_role,
            members_count=members_count,
            last_message=(last_msg.message if last_msg and last_msg.message else (
                "📎 Вложение" if last_msg else None
            )),
            last_message_time=last_msg.timestamp if last_msg else None,
            unread_count=0
        ))

    groups_data.sort(key=lambda g: g.last_message_time or datetime.min, reverse=True)
    return groups_data


@router.get("/{group_id}", response_model=GroupChatDetailResponse)
async def get_group_detail(
    group_id: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    membership = await _require_membership(db, group_id, current_user.id)

    result = await db.execute(select(GroupChat).where(GroupChat.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")

    members_result = await db.execute(
        select(GroupChatMember, UserModel)
        .join(UserModel, UserModel.id == GroupChatMember.user_id)
        .where(GroupChatMember.group_id == group_id)
    )
    members = [
        GroupChatMemberResponse(
            user_id=user.id,
            role=member.role,
            first_name=user.first_name,
            last_name=user.last_name,
            avatar_url=user.avatar_url
        )
        for member, user in members_result.all()
    ]

    return GroupChatDetailResponse(
        id=group.id,
        name=group.name,
        avatar_url=group.avatar_url,
        owner_id=group.owner_id,
        my_role=membership.role,
        members=members
    )


@router.patch("/{group_id}", response_model=GroupChatDetailResponse)
async def update_group(
    group_id: int,
    payload: GroupChatUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    await _require_admin_or_owner(db, group_id, current_user.id)

    result = await db.execute(select(GroupChat).where(GroupChat.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")

    if payload.name is not None and payload.name.strip():
        group.name = payload.name.strip()
    if payload.avatar_url is not None:
        group.avatar_url = payload.avatar_url

    await db.commit()
    return await get_group_detail(group_id, db=db, current_user=current_user)


@router.post("/{group_id}/members", response_model=GroupChatDetailResponse)
async def add_group_members(
    group_id: int,
    payload: AddGroupMembersRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    # Добавлять участников могут владелец группы и администраторы
    await _require_admin_or_owner(db, group_id, current_user.id)

    existing_result = await db.execute(
        select(GroupChatMember.user_id).where(GroupChatMember.group_id == group_id)
    )
    existing_ids = {row[0] for row in existing_result.all()}

    new_ids = {uid for uid in payload.user_ids if uid not in existing_ids}
    if new_ids:
        result = await db.execute(select(UserModel.id).where(UserModel.id.in_(new_ids)))
        valid_ids = {row[0] for row in result.all()}
        for uid in valid_ids:
            db.add(GroupChatMember(group_id=group_id, user_id=uid, role="member"))
        await db.commit()

    return await get_group_detail(group_id, db=db, current_user=current_user)


@router.delete("/{group_id}/members/{user_id}", response_model=GroupChatDetailResponse)
async def remove_group_member(
    group_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    acting_membership = await _require_admin_or_owner(db, group_id, current_user.id)

    target_membership = await _get_membership(db, group_id, user_id)
    if not target_membership:
        raise HTTPException(status_code=404, detail="Пользователь не состоит в группе")

    if target_membership.role == "owner":
        raise HTTPException(status_code=400, detail="Нельзя удалить владельца группы")

    # Администратор не может удалить другого администратора - только владелец
    if target_membership.role == "admin" and acting_membership.role != "owner":
        raise HTTPException(status_code=403, detail="Только владелец может удалить администратора")

    await db.delete(target_membership)
    await db.commit()

    return await get_group_detail(group_id, db=db, current_user=current_user)


@router.post("/{group_id}/admins/{user_id}", response_model=GroupChatDetailResponse)
async def promote_to_admin(
    group_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    # Назначать администраторов может только владелец группы
    owner_membership = await _require_membership(db, group_id, current_user.id)
    if owner_membership.role != "owner":
        raise HTTPException(status_code=403, detail="Только владелец может назначать администраторов")

    target_membership = await _get_membership(db, group_id, user_id)
    if not target_membership:
        raise HTTPException(status_code=404, detail="Пользователь не состоит в группе")
    if target_membership.role == "owner":
        raise HTTPException(status_code=400, detail="Владелец уже обладает правами администратора")

    target_membership.role = "admin"
    await db.commit()

    return await get_group_detail(group_id, db=db, current_user=current_user)


@router.delete("/{group_id}/admins/{user_id}", response_model=GroupChatDetailResponse)
async def demote_admin(
    group_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    owner_membership = await _require_membership(db, group_id, current_user.id)
    if owner_membership.role != "owner":
        raise HTTPException(status_code=403, detail="Только владелец может снимать права администратора")

    target_membership = await _get_membership(db, group_id, user_id)
    if not target_membership or target_membership.role != "admin":
        raise HTTPException(status_code=404, detail="Пользователь не является администратором")

    target_membership.role = "member"
    await db.commit()

    return await get_group_detail(group_id, db=db, current_user=current_user)


@router.post("/{group_id}/leave")
async def leave_group(
    group_id: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    membership = await _require_membership(db, group_id, current_user.id)
    if membership.role == "owner":
        raise HTTPException(
            status_code=400,
            detail="Владелец не может покинуть группу, удалите группу или передайте владение"
        )

    await db.delete(membership)
    await db.commit()
    return {"success": True}


@router.delete("/{group_id}")
async def delete_group(
    group_id: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_user)
):
    membership = await _require_membership(db, group_id, current_user.id)
    if membership.role != "owner":
        raise HTTPException(status_code=403, detail="Только владелец может удалить группу")

    result = await db.execute(select(GroupChat).where(GroupChat.id == group_id))
    group = result.scalar_one_or_none()
    if group:
        await db.delete(group)
        await db.commit()
    return {"success": True}
