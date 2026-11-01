"""Баланс, аналитика, бюджеты и разбор возможных переводов."""
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_async_db
from app.core.auth import get_current_user
from app.models.journal import JournalTransaction
from app.models.journal.base import utcnow
from app.models.users import User as UserModel
from app.schemas.journal.common import MAX_DATE, MIN_DATE
from app.schemas.journal.finance import FinanceSummary, TransferPairMergeRequest
from app.services.journal import finance
from app.services.journal.sync_service import lock_state, next_rev
from app.services.journal.bank_import.transfers import find_transfer_candidates

router = APIRouter(prefix="/api/journal", tags=["journal"])


@router.get("/finance/balances")
async def finance_balances(
    current_user: UserModel = Depends(get_current_user), db: AsyncSession = Depends(get_async_db),
):
    return {"accounts": await finance.account_balances(db, current_user.id)}


@router.get("/finance/budgets")
async def finance_budgets(
    month: str = Query(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    current_user: UserModel = Depends(get_current_user), db: AsyncSession = Depends(get_async_db),
):
    return {"items": await finance.budget_status(db, current_user.id, month)}


@router.get("/finance/analytics", response_model=FinanceSummary)
async def finance_analytics(
    date_from: date = Query(..., alias="from"), date_to: date = Query(..., alias="to"),
    current_user: UserModel = Depends(get_current_user), db: AsyncSession = Depends(get_async_db),
):
    if not (MIN_DATE <= date_from <= MAX_DATE and MIN_DATE <= date_to <= MAX_DATE):
        raise HTTPException(status_code=422, detail="Дата вне допустимого диапазона")
    if date_to < date_from or (date_to - date_from).days > 366:
        raise HTTPException(status_code=422, detail="Период должен быть от 1 до 367 дней")
    return await finance.finance_summary(db, current_user.id, date_from, date_to)


@router.get("/finance/review")
async def finance_review(
    limit: int = Query(default=100, ge=1, le=500),
    current_user: UserModel = Depends(get_current_user), db: AsyncSession = Depends(get_async_db),
):
    return await finance.review_queue(db, current_user.id, limit)


@router.get("/finance/transfer-pairs")
async def transfer_pairs(
    current_user: UserModel = Depends(get_current_user), db: AsyncSession = Depends(get_async_db),
):
    rows = (await db.execute(select(JournalTransaction).where(
        JournalTransaction.user_id == current_user.id, JournalTransaction.deleted_at.is_(None),
        JournalTransaction.direction.in_(["income", "expense"]), JournalTransaction.account_id.is_not(None),
    ))).scalars().all()
    candidates = find_transfer_candidates([], [{
        "client_uuid": row.client_uuid, "account_id": row.account_id, "transaction_date": row.transaction_date,
        "direction": row.direction, "amount_kop": row.amount_kop,
    } for row in rows])
    return {"items": candidates}


@router.post("/finance/transfer-pairs/merge")
async def merge_transfer_pair(
    payload: TransferPairMergeRequest,
    current_user: UserModel = Depends(get_current_user), db: AsyncSession = Depends(get_async_db),
):
    if payload.first_uuid == payload.second_uuid:
        raise HTTPException(status_code=422, detail="Нужны две разные операции")
    rows = (await db.execute(select(JournalTransaction).where(
        JournalTransaction.user_id == current_user.id,
        JournalTransaction.client_uuid.in_([payload.first_uuid, payload.second_uuid]),
        JournalTransaction.deleted_at.is_(None),
    ))).scalars().all()
    if len(rows) != 2:
        raise HTTPException(status_code=404, detail="Пара операций не найдена")
    expense = next((row for row in rows if row.direction == "expense"), None)
    income = next((row for row in rows if row.direction == "income"), None)
    if (expense is None or income is None or expense.account_id == income.account_id
            or expense.amount_kop != income.amount_kop
            or abs((expense.transaction_date - income.transaction_date).days) > 2):
        raise HTTPException(status_code=422, detail="Операции не являются парой перевода")
    state = await lock_state(db, current_user.id)
    now = utcnow()
    expense.direction = "transfer"
    expense.to_account_id = income.account_id
    expense.category_id = None
    expense.transfer_pair_uuid = str(uuid.uuid4())
    expense.updated_at = now
    expense.server_rev = next_rev(state)
    income.deleted_at = now
    income.updated_at = now
    income.server_rev = next_rev(state)
    await db.commit()
    return {"status": "merged", "transaction_uuid": expense.client_uuid}
