import asyncio
import ipaddress
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from yookassa.domain.notification import WebhookNotification

from app.api.dependencies import get_async_db
from app.models.orders import Order as OrderModel, OrderItem as OrderItemModel
from app.models.users import User as UserModel
from app.api.routers.notifications import manager as notifications_manager
from app.core.fcm import send_fcm_notification

router = APIRouter(
    prefix="/payments",
    tags=["payments"],
)

# Список сетей/адресов ЮKassa (Яндекс.Касса) для проверки источника вебхука
YANDEX_IP_LIST: tuple[str, ...] = (
    "185.71.76.0/27",
    "185.71.77.0/27",
    "77.75.153.0/25",
    "77.75.156.11",
    "77.75.156.35",
    "77.75.154.128/25",
    "2a02:5180::/32",
)


def is_ip_allowed(ip: str | None) -> bool:
    if ip is None:
        return False
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False

    for mask in YANDEX_IP_LIST:
        if "/" in mask:
            if address in ipaddress.ip_network(mask, strict=False):
                return True
        else:
            if address == ipaddress.ip_address(mask):
                return True
    return False


def _extract_client_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else None


@router.post("/yookassa/webhook", status_code=status.HTTP_200_OK)
async def yookassa_webhook(
        request: Request,
        db: AsyncSession = Depends(get_async_db),
):
    client_ip = _extract_client_ip(request)
    if not is_ip_allowed(client_ip):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="IP not allowed")

    try:
        payload = await request.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid JSON: {exc}")

    try:
        notification = WebhookNotification(payload)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Invalid notification: {exc}")

    payment = notification.object
    order_id = payment.metadata.get("order_id") if payment.metadata else None

    if not order_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing order id")

    result = await db.scalars(
        select(OrderModel)
        .where(OrderModel.id == int(order_id))
    )
    order = result.first()
    if order is None:
        return {"status": "ignored"}

    if payment.status == "succeeded":
        if not order.paid_at:
            order.status = "paid"
            order.paid_at = datetime.now(timezone.utc)
            order.payment_id = payment.id
            await db.commit()
            await _notify_order_status(db, order, "paid")
        else:
            await db.commit()
        return {"status": "ok"}
    elif payment.status == "canceled":
        order.status = "canceled"
        await db.commit()
        await _notify_order_status(db, order, "canceled")
        return {"status": "ok"}

    await db.commit()
    return {"status": "ok"}


async def _notify_order_status(db: AsyncSession, order: OrderModel, new_status: str):
    """Отправляет уведомления покупателю и продавцам при изменении статуса заказа."""
    status_labels = {
        "paid": "Оплачен",
        "canceled": "Отменён",
        "shipped": "Отправлен",
        "delivered": "Доставлен",
        "processing": "В обработке",
    }
    status_label = status_labels.get(new_status, new_status)

    # Загружаем покупателя и продавцов
    buyer_result = await db.scalars(select(UserModel).where(UserModel.id == order.user_id))
    buyer = buyer_result.first()

    # Собираем уникальных продавцов из позиций заказа
    from app.models.products import Product as ProductModel
    items_result = await db.scalars(
        select(OrderItemModel)
        .options(selectinload(OrderItemModel.product))
        .where(OrderItemModel.order_id == order.id)
    )
    items = list(items_result.all())

    seller_ids = set()
    for item in items:
        if item.product and item.product.seller_id:
            seller_ids.add(item.product.seller_id)

    # Уведомление покупателю
    buyer_msg = {
        "type": "order_status_changed",
        "order_id": order.id,
        "status": new_status,
        "status_label": status_label,
        "message": f"Статус вашего заказа #{order.id} изменён: {status_label}"
    }
    asyncio.create_task(notifications_manager.send_personal_message(buyer_msg, order.user_id))
    if buyer and buyer.fcm_token:
        asyncio.create_task(send_fcm_notification(
            token=buyer.fcm_token,
            title=f"Заказ #{order.id}: {status_label}",
            body=buyer_msg["message"],
            data={k: str(v) for k, v in buyer_msg.items()},
        ))

    # Уведомление продавцам
    for seller_id in seller_ids:
        seller_result = await db.scalars(select(UserModel).where(UserModel.id == seller_id))
        seller = seller_result.first()
        seller_msg = {
            "type": "order_status_changed",
            "order_id": order.id,
            "status": new_status,
            "status_label": status_label,
            "message": f"Заказ #{order.id} от покупателя изменил статус: {status_label}"
        }
        asyncio.create_task(notifications_manager.send_personal_message(seller_msg, seller_id))
        if seller and seller.fcm_token:
            asyncio.create_task(send_fcm_notification(
                token=seller.fcm_token,
                title=f"Заказ #{order.id}: {status_label}",
                body=seller_msg["message"],
                data={k: str(v) for k, v in seller_msg.items()},
            ))


