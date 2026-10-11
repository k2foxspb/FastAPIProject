import asyncio
import calendar
import io
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_async_db
from app.core.auth import get_current_production_user
from app.core.production import (
    can_view_timesheet,
    can_edit_timesheet,
    can_review_production,
    can_edit_production_entry,
    find_nearest_supervisors,
    get_subordinates,
)
from app.core.roles import get_table_role_label
from app.api.routers.notifications import manager as notification_manager
from app.core.fcm import send_fcm_notification
from app.models.users import User as UserModel
from app.models.timesheet import (
    TimesheetEntry as TimesheetEntryModel,
    Product as ProductModel,
    ProductionEntry as ProductionEntryModel,
    ProductionEntryItem as ProductionEntryItemModel,
    ProductionAuditLog as ProductionAuditLogModel,
    PRODUCTION_STATUS_DRAFT,
    PRODUCTION_STATUS_PENDING,
    PRODUCTION_STATUS_APPROVED,
    PRODUCTION_STATUS_REJECTED,
)
from app.schemas.timesheet import (
    TimesheetEntryUpsert,
    TimesheetEntry as TimesheetEntrySchema,
    Product as ProductSchema,
    ProductCreate,
    ProductUpdate,
    ProductionEntryUpsert,
    ProductionEntryReject,
    ProductionEntry as ProductionEntrySchema,
    ProductionEntryDetail as ProductionEntryDetailSchema,
    DayTimesheetInfo,
    SubordinateSummary,
    SubordinateDay,
    EmployeeBrief,
)

router = APIRouter(prefix="/timesheet", tags=["timesheet"])


def _user_name(user: UserModel | None) -> str:
    if user is None:
        return ""
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or user.email or user.phone_number or f"#{user.id}"


async def _get_user_or_404(db: AsyncSession, user_id: int) -> UserModel:
    result = await db.execute(select(UserModel).where(UserModel.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


def _fill_timesheet_grid_sheet(ws, year: int, month: int, rows: list[dict]) -> None:
    """
    Заполняет лист в формате классического табеля учёта рабочего времени:
    по дням месяца с разбивкой каждой строки сотрудника на "основное" и
    "сверхурочное" время (значения берутся напрямую из табеля, т.к. они
    вводятся сотрудником/руководителем явно, а не высчитываются по норме),
    подытогами за 1-ю половину месяца и за весь месяц, количеством выходных
    и общим количеством сданных приборов в конце строки.

    rows: список словарей с ключами:
      number, tab_number, grade, fio,
      hours_by_date (dict[date, tuple[Decimal, Decimal, str | None]] -
        (основное, сверхурочное, текстовая отметка вместо часов)),
      products_total (Decimal)
    """
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    weekend_fill = PatternFill(start_color="FFFF00", end_color="FFFF00", fill_type="solid")
    header_fill = PatternFill(start_color="D9D9D9", end_color="D9D9D9", fill_type="solid")
    thin_border = Border(
        left=Side(style="thin"), right=Side(style="thin"),
        top=Side(style="thin"), bottom=Side(style="thin"),
    )
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)

    last_day = calendar.monthrange(year, month)[1]
    days = list(range(1, last_day + 1))
    half = 15 if last_day >= 15 else last_day

    headers = ["№", "Таб. номер", "Разряд", "Фамилия, имя, отчество", "Время"]
    day_col_index: dict[int, int] = {}
    for d in days:
        headers.append(str(d))
        day_col_index[d] = len(headers)
        if d == half:
            headers.append("За 1-ю половину\n(дни)")
            half_days_col = len(headers)
            headers.append("За 1-ю половину\n(часы)")
            half_hours_col = len(headers)
    headers.append("За месяц\n(дни)")
    month_days_col = len(headers)
    headers.append("За месяц\n(часы)")
    month_hours_col = len(headers)
    headers.append("Выходные")
    weekend_col = len(headers)
    headers.append("Приборы, всего")
    products_col = len(headers)

    for idx, title in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=idx, value=title)
        cell.font = Font(bold=True)
        cell.alignment = center
        cell.border = thin_border
        cell.fill = header_fill

    weekend_days = {d for d in days if date(year, month, d).weekday() in (5, 6)}
    for d in weekend_days:
        ws.cell(row=1, column=day_col_index[d]).fill = weekend_fill

    row_num = 2
    for row_data in rows:
        hours_by_date = row_data["hours_by_date"]
        for label in ("основное", "сверхурочное"):
            is_first = label == "основное"
            ws.cell(row=row_num, column=1, value=row_data["number"] if is_first else None).border = thin_border
            ws.cell(row=row_num, column=2, value=row_data["tab_number"] if is_first else None).border = thin_border
            ws.cell(row=row_num, column=3, value=row_data["grade"] if is_first else None).border = thin_border
            ws.cell(row=row_num, column=4, value=row_data["fio"] if is_first else None).border = thin_border
            ws.cell(row=row_num, column=5, value=label).border = thin_border

            half_days_count = 0
            half_hours_sum = Decimal("0")
            month_days_count = 0
            month_hours_sum = Decimal("0")

            for d in days:
                base_hours, overtime_hours, text_value = hours_by_date.get(
                    date(year, month, d), (Decimal("0"), Decimal("0"), None)
                )
                value = base_hours if is_first else overtime_hours

                cell = ws.cell(row=row_num, column=day_col_index[d])
                cell.border = thin_border
                cell.alignment = center
                if d in weekend_days:
                    cell.fill = weekend_fill
                if text_value and is_first:
                    # Текстовая отметка (например больничный) показывается вместо числа часов
                    # и не учитывается в итогах.
                    cell.value = text_value
                elif value > 0:
                    cell.value = float(value)
                    month_days_count += 1
                    month_hours_sum += value
                    if d <= half:
                        half_days_count += 1
                        half_hours_sum += value

            ws.cell(row=row_num, column=half_days_col, value=half_days_count).border = thin_border
            ws.cell(row=row_num, column=half_hours_col, value=float(half_hours_sum)).border = thin_border
            ws.cell(row=row_num, column=month_days_col, value=month_days_count).border = thin_border
            ws.cell(row=row_num, column=month_hours_col, value=float(month_hours_sum)).border = thin_border
            ws.cell(row=row_num, column=weekend_col, value=len(weekend_days) if is_first else None).border = thin_border
            ws.cell(
                row=row_num, column=products_col,
                value=float(row_data["products_total"]) if is_first else None,
            ).border = thin_border

            row_num += 1

    ws.column_dimensions["D"].width = 28
    for d in days:
        ws.column_dimensions[ws.cell(row=1, column=day_col_index[d]).column_letter].width = 6
    ws.freeze_panes = "F2"


# ------------------------------------------------------------------
# Табель рабочего времени
# ------------------------------------------------------------------

@router.get("/{user_id}", response_model=list[TimesheetEntrySchema])
async def get_user_timesheet(
    user_id: int,
    year: int,
    month: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Возвращает табель пользователя за месяц (правило 1 - доступ по иерархии)."""
    target = await _get_user_or_404(db, user_id)
    if not can_view_timesheet(current_user, target):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this timesheet")

    start, end = _month_bounds(year, month)
    result = await db.execute(
        select(TimesheetEntryModel).where(
            TimesheetEntryModel.user_id == user_id,
            TimesheetEntryModel.date >= start,
            TimesheetEntryModel.date <= end,
        )
    )
    return result.scalars().all()


@router.put("/{user_id}", response_model=TimesheetEntrySchema)
async def upsert_timesheet_day(
    user_id: int,
    data: TimesheetEntryUpsert,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Создаёт/обновляет количество часов за день (правило 1 - доступ по иерархии)."""
    target = await _get_user_or_404(db, user_id)
    if not can_edit_timesheet(current_user, target):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to edit this timesheet")

    result = await db.execute(
        select(TimesheetEntryModel).where(
            TimesheetEntryModel.user_id == user_id,
            TimesheetEntryModel.date == data.date,
        )
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        entry = TimesheetEntryModel(
            user_id=user_id,
            date=data.date,
            hours=data.hours,
            overtime_hours=data.overtime_hours,
            text_value=data.text_value,
            comment=data.comment,
            created_by_id=current_user.id,
            updated_by_id=current_user.id,
        )
        db.add(entry)
    else:
        entry.hours = data.hours
        entry.overtime_hours = data.overtime_hours
        entry.text_value = data.text_value
        entry.comment = data.comment
        entry.updated_by_id = current_user.id

    await db.commit()
    await db.refresh(entry)
    return entry


# ------------------------------------------------------------------
# Справочник продукции (CRUD)
# ------------------------------------------------------------------

@router.get("/products/list", response_model=list[ProductSchema])
async def list_products(
    include_inactive: bool = False,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    query = select(ProductModel)
    if not include_inactive:
        query = query.where(ProductModel.is_active == True)
    query = query.order_by(ProductModel.name.asc())
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/products", response_model=ProductSchema, status_code=status.HTTP_201_CREATED)
async def create_product(
    data: ProductCreate,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    product = ProductModel(name=data.name, code=data.code, unit=data.unit, is_active=data.is_active)
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return product


@router.put("/products/{product_id}", response_model=ProductSchema)
async def update_product(
    product_id: int,
    data: ProductUpdate,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    result = await db.execute(select(ProductModel).where(ProductModel.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    for field in ("name", "code", "unit", "is_active"):
        value = getattr(data, field)
        if value is not None:
            setattr(product, field, value)

    await db.commit()
    await db.refresh(product)
    return product


@router.delete("/products/{product_id}")
async def delete_product(
    product_id: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Деактивирует продукцию (мягкое удаление, чтобы не потерять историю сданных позиций)."""
    result = await db.execute(select(ProductModel).where(ProductModel.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    product.is_active = False
    await db.commit()
    return {"status": "ok"}


# ------------------------------------------------------------------
# Записи о сданной продукции
# ------------------------------------------------------------------

async def _load_entry(db: AsyncSession, entry_id: int) -> ProductionEntryModel:
    result = await db.execute(
        select(ProductionEntryModel)
        .options(
            selectinload(ProductionEntryModel.items).selectinload(ProductionEntryItemModel.product),
            selectinload(ProductionEntryModel.user),
            selectinload(ProductionEntryModel.reviewer),
            selectinload(ProductionEntryModel.logs).selectinload(ProductionAuditLogModel.actor),
        )
        .where(ProductionEntryModel.id == entry_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Production entry not found")
    return entry


async def _get_hours_for_date(db: AsyncSession, user_id: int, day: date) -> tuple[Decimal, Decimal, str | None]:
    """Возвращает (основное, сверхурочное, текстовая отметка) из табеля за день."""
    result = await db.execute(
        select(
            TimesheetEntryModel.hours, TimesheetEntryModel.overtime_hours, TimesheetEntryModel.text_value
        ).where(
            TimesheetEntryModel.user_id == user_id, TimesheetEntryModel.date == day
        )
    )
    row = result.one_or_none()
    if row is None:
        return Decimal("0"), Decimal("0"), None
    base_hours, overtime_hours, text_value = row
    return base_hours or Decimal("0"), overtime_hours or Decimal("0"), text_value


def _entry_to_schema(
    entry: ProductionEntryModel,
    current_user: UserModel,
    base_hours: Decimal | None = None,
    overtime_hours: Decimal | None = None,
    text_value: str | None = None,
) -> ProductionEntrySchema:
    schema = ProductionEntrySchema.model_validate(entry)
    schema.base_hours = base_hours
    schema.overtime_hours = overtime_hours
    schema.hours = (base_hours + overtime_hours) if base_hours is not None and overtime_hours is not None else None
    schema.text_value = text_value
    schema.can_edit = can_edit_production_entry(current_user, entry.user, entry.status)
    return schema


async def _notify_supervisors(db: AsyncSession, entry: ProductionEntryModel, hours: Decimal, resubmit: bool = False):
    supervisors = await find_nearest_supervisors(db, entry.user)
    if not supervisors:
        return

    items_summary = ", ".join(
        f"{item.product.name if item.product else item.product_id} x{item.quantity}" for item in entry.items
    )
    employee_name = _user_name(entry.user)
    message = {
        "type": "production_entry_resubmitted" if resubmit else "production_entry_submitted",
        "entry_id": entry.id,
        "employee_id": entry.user_id,
        "employee_name": employee_name,
        "date": entry.date.isoformat(),
        "items": items_summary,
        "hours": str(hours),
    }
    title = "Повторная отправка на согласование" if resubmit else "Новая сдача продукции на согласование"
    body = f"{employee_name} - {entry.date.isoformat()}: {items_summary or 'без позиций'} ({hours} ч)"

    for supervisor in supervisors:
        asyncio.create_task(notification_manager.send_personal_message(message, supervisor.id))
        if supervisor.fcm_token:
            asyncio.create_task(send_fcm_notification(
                token=supervisor.fcm_token,
                title=title,
                body=body,
                data=message,
                sender_id=entry.user_id,
            ))


@router.get("/subordinates/summary", response_model=list[SubordinateSummary])
async def get_subordinates_summary(
    year: int,
    month: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Сводная таблица по всем подчинённым текущего пользователя за месяц: часы
    из табеля по каждому дню и статус сданной продукции - чтобы видеть всех
    подчинённых сразу и переходить к редактированию часов/согласованию.
    """
    subordinates = await get_subordinates(db, current_user)
    if not subordinates:
        return []

    sub_ids = [u.id for u in subordinates]
    start, end = _month_bounds(year, month)

    hours_result = await db.execute(
        select(TimesheetEntryModel).where(
            TimesheetEntryModel.user_id.in_(sub_ids),
            TimesheetEntryModel.date >= start,
            TimesheetEntryModel.date <= end,
        )
    )
    hours_by_key: dict[tuple[int, date], tuple[Decimal, Decimal, str | None]] = {
        (e.user_id, e.date): (e.hours, e.overtime_hours, e.text_value) for e in hours_result.scalars().all()
    }

    entries_result = await db.execute(
        select(ProductionEntryModel).where(
            ProductionEntryModel.user_id.in_(sub_ids),
            ProductionEntryModel.date >= start,
            ProductionEntryModel.date <= end,
        )
    )
    entries_by_key: dict[tuple[int, date], ProductionEntryModel] = {
        (e.user_id, e.date): e for e in entries_result.scalars().all()
    }

    summaries = []
    for user in subordinates:
        days = []
        total_hours = Decimal("0")
        pending_count = 0
        for day_num in range(1, end.day + 1):
            day = date(year, month, day_num)
            base_hours, overtime_hours, text_value = hours_by_key.get((user.id, day), (Decimal("0"), Decimal("0"), None))
            hours = base_hours + overtime_hours
            total_hours += hours
            entry = entries_by_key.get((user.id, day))
            if entry is not None and entry.status == PRODUCTION_STATUS_PENDING:
                pending_count += 1
            days.append(SubordinateDay(
                date=day,
                hours=hours,
                base_hours=base_hours,
                overtime_hours=overtime_hours,
                text_value=text_value,
                status=entry.status if entry else None,
                entry_id=entry.id if entry else None,
            ))
        summaries.append(SubordinateSummary(
            user=EmployeeBrief.model_validate(user),
            days=days,
            total_hours=total_hours,
            pending_count=pending_count,
        ))
    return summaries


@router.get("/subordinates/summary/export")
async def export_subordinates_summary_excel(
    year: int,
    month: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Выгружает в Excel сводный табель по всем подчинённым текущего
    пользователя за месяц - по строкам сотрудники (с разбивкой на
    "основное"/"сверхурочное" время), в конце строки - общее количество
    сданных приборов за месяц.
    """
    from openpyxl import Workbook

    subordinates = await get_subordinates(db, current_user)
    if not subordinates:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No subordinates found")

    sub_ids = [u.id for u in subordinates]
    start, end = _month_bounds(year, month)

    hours_result = await db.execute(
        select(TimesheetEntryModel).where(
            TimesheetEntryModel.user_id.in_(sub_ids),
            TimesheetEntryModel.date >= start,
            TimesheetEntryModel.date <= end,
        )
    )
    hours_by_user: dict[int, dict[date, tuple[Decimal, Decimal, str | None]]] = {uid: {} for uid in sub_ids}
    for e in hours_result.scalars().all():
        hours_by_user[e.user_id][e.date] = (e.hours, e.overtime_hours, e.text_value)

    entries_result = await db.execute(
        select(ProductionEntryModel)
        .options(selectinload(ProductionEntryModel.items))
        .where(
            ProductionEntryModel.user_id.in_(sub_ids),
            ProductionEntryModel.date >= start,
            ProductionEntryModel.date <= end,
        )
    )
    products_by_user: dict[int, Decimal] = {uid: Decimal("0") for uid in sub_ids}
    for e in entries_result.scalars().all():
        products_by_user[e.user_id] += sum((item.quantity for item in e.items), Decimal("0"))

    rows = [
        {
            "number": idx + 1,
            "tab_number": user.id,
            "grade": get_table_role_label(user.role),
            "fio": _user_name(user),
            "hours_by_date": hours_by_user.get(user.id, {}),
            "products_total": products_by_user.get(user.id, Decimal("0")),
        }
        for idx, user in enumerate(subordinates)
    ]

    wb = Workbook()
    ws_timesheet = wb.active
    ws_timesheet.title = "Табель"
    _fill_timesheet_grid_sheet(ws_timesheet, year, month, rows)

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    filename = f"timesheet_subordinates_{year}_{month:02d}.xlsx"

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/production/entries/pending", response_model=list[ProductionEntrySchema])
async def list_pending_entries(
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Записи, ожидающие согласования, по всем подчинённым текущего пользователя
    согласно иерархии должностей.
    """
    result = await db.execute(
        select(ProductionEntryModel)
        .options(
            selectinload(ProductionEntryModel.items).selectinload(ProductionEntryItemModel.product),
            selectinload(ProductionEntryModel.user),
        )
        .where(ProductionEntryModel.status == PRODUCTION_STATUS_PENDING)
        .order_by(ProductionEntryModel.submitted_at.asc())
    )
    entries = result.scalars().all()
    visible = [e for e in entries if can_review_production(current_user, e.user)]

    schemas = []
    for entry in visible:
        base_hours, overtime_hours, text_value = await _get_hours_for_date(db, entry.user_id, entry.date)
        schemas.append(_entry_to_schema(entry, current_user, base_hours, overtime_hours, text_value))
    return schemas


@router.get("/production/{user_id}", response_model=list[DayTimesheetInfo])
async def get_user_production_month(
    user_id: int,
    year: int,
    month: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Данные вкладки "Количество сданной продукции" по дням месяца: часы из
    табеля (автоподгрузка) + запись о сданной продукции за каждый день, если
    она есть.
    """
    target = await _get_user_or_404(db, user_id)
    if not can_view_timesheet(current_user, target):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this timesheet")

    start, end = _month_bounds(year, month)

    hours_result = await db.execute(
        select(TimesheetEntryModel).where(
            TimesheetEntryModel.user_id == user_id,
            TimesheetEntryModel.date >= start,
            TimesheetEntryModel.date <= end,
        )
    )
    hours_by_date = {e.date: (e.hours, e.overtime_hours, e.text_value) for e in hours_result.scalars().all()}

    entries_result = await db.execute(
        select(ProductionEntryModel)
        .options(
            selectinload(ProductionEntryModel.items).selectinload(ProductionEntryItemModel.product),
            selectinload(ProductionEntryModel.user),
            selectinload(ProductionEntryModel.reviewer),
        )
        .where(
            ProductionEntryModel.user_id == user_id,
            ProductionEntryModel.date >= start,
            ProductionEntryModel.date <= end,
        )
    )
    entries_by_date = {e.date: e for e in entries_result.scalars().all()}

    days = []
    for day_num in range(1, end.day + 1):
        day = date(year, month, day_num)
        base_hours, overtime_hours, text_value = hours_by_date.get(day, (Decimal("0"), Decimal("0"), None))
        entry = entries_by_date.get(day)
        entry_schema = _entry_to_schema(entry, current_user, base_hours, overtime_hours, text_value) if entry else None
        days.append(DayTimesheetInfo(
            date=day, hours=base_hours + overtime_hours,
            base_hours=base_hours, overtime_hours=overtime_hours, text_value=text_value, entry=entry_schema,
        ))
    return days


@router.get("/production/entry/{entry_id}", response_model=ProductionEntryDetailSchema)
async def get_production_entry(
    entry_id: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    entry = await _load_entry(db, entry_id)
    if not (can_view_timesheet(current_user, entry.user)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    base_hours, overtime_hours, text_value = await _get_hours_for_date(db, entry.user_id, entry.date)
    schema = ProductionEntryDetailSchema.model_validate(entry)
    schema.base_hours = base_hours
    schema.overtime_hours = overtime_hours
    schema.hours = base_hours + overtime_hours
    schema.text_value = text_value
    schema.can_edit = can_edit_production_entry(current_user, entry.user, entry.status)
    return schema


@router.post("/production", response_model=ProductionEntrySchema, status_code=status.HTTP_201_CREATED)
async def upsert_production_entry(
    data: ProductionEntryUpsert,
    submit: bool = False,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Создаёт или обновляет запись о сданной продукции сотрудника за день
    (всегда для самого текущего пользователя - правило 4). Если submit=True,
    запись сразу отправляется на согласование (правило 11 - нельзя отправить
    пустую запись) и уведомляется ближайший вышестоящий пользователь.
    """
    result = await db.execute(
        select(ProductionEntryModel)
        .options(selectinload(ProductionEntryModel.items))
        .where(
            ProductionEntryModel.user_id == current_user.id,
            ProductionEntryModel.date == data.date,
        )
    )
    entry = result.scalar_one_or_none()

    is_new = entry is None
    if entry is None:
        entry = ProductionEntryModel(
            user_id=current_user.id,
            date=data.date,
            status=PRODUCTION_STATUS_DRAFT,
        )
        db.add(entry)
        await db.flush()
    else:
        if not can_edit_production_entry(current_user, entry.user or current_user, entry.status):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot edit an approved or rejected production entry",
            )
        for item in list(entry.items):
            await db.delete(item)
        await db.flush()

    old_values = None if is_new else {"items": [
        {"product_id": i.product_id, "quantity": float(i.quantity)} for i in entry.items
    ]}

    for item_data in data.items:
        db.add(ProductionEntryItemModel(
            entry_id=entry.id,
            product_id=item_data.product_id,
            quantity=item_data.quantity,
            comment=item_data.comment,
        ))

    was_rejected = entry.status == PRODUCTION_STATUS_REJECTED

    if submit:
        if not data.items:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot submit an empty entry")
        entry.status = PRODUCTION_STATUS_PENDING
        entry.submitted_at = datetime.now(timezone.utc)
        entry.reviewer_comment = None
        entry.reviewed_at = None

    await db.flush()

    log = ProductionAuditLogModel(
        entry_id=entry.id,
        actor_id=current_user.id,
        action="created" if is_new else ("resubmitted" if was_rejected and submit else "updated"),
        old_values=old_values,
        new_values={"items": [
            {"product_id": i.product_id, "quantity": float(i.quantity)} for i in data.items
        ], "submitted": submit},
    )
    db.add(log)
    await db.commit()

    entry = await _load_entry(db, entry.id)
    base_hours, overtime_hours, text_value = await _get_hours_for_date(db, entry.user_id, entry.date)

    if submit:
        await _notify_supervisors(db, entry, base_hours + overtime_hours, resubmit=was_rejected)

    return _entry_to_schema(entry, current_user, base_hours, overtime_hours, text_value)


@router.post("/production/entry/{entry_id}/submit", response_model=ProductionEntrySchema)
async def submit_production_entry(
    entry_id: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Отправляет уже существующую (черновую/отклонённую) запись на согласование."""
    entry = await _load_entry(db, entry_id)
    if not can_edit_production_entry(current_user, entry.user, entry.status):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot submit this entry")
    if not entry.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot submit an empty entry")

    was_rejected = entry.status == PRODUCTION_STATUS_REJECTED
    entry.status = PRODUCTION_STATUS_PENDING
    entry.submitted_at = datetime.now(timezone.utc)
    entry.reviewer_comment = None
    entry.reviewed_at = None

    db.add(ProductionAuditLogModel(
        entry_id=entry.id,
        actor_id=current_user.id,
        action="resubmitted" if was_rejected else "submitted",
    ))
    await db.commit()

    entry = await _load_entry(db, entry.id)
    base_hours, overtime_hours, text_value = await _get_hours_for_date(db, entry.user_id, entry.date)
    await _notify_supervisors(db, entry, base_hours + overtime_hours, resubmit=was_rejected)
    return _entry_to_schema(entry, current_user, base_hours, overtime_hours, text_value)


@router.post("/production/entry/{entry_id}/approve", response_model=ProductionEntrySchema)
async def approve_production_entry(
    entry_id: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Подтверждает запись (правило 11 - только вышестоящий пользователь, не сам сотрудник)."""
    entry = await _load_entry(db, entry_id)
    if not can_review_production(current_user, entry.user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if entry.status != PRODUCTION_STATUS_PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Entry is not pending approval")

    entry.status = PRODUCTION_STATUS_APPROVED
    entry.reviewer_id = current_user.id
    entry.reviewed_at = datetime.now(timezone.utc)
    entry.reviewer_comment = None

    db.add(ProductionAuditLogModel(entry_id=entry.id, actor_id=current_user.id, action="approved"))
    await db.commit()

    entry = await _load_entry(db, entry.id)
    base_hours, overtime_hours, text_value = await _get_hours_for_date(db, entry.user_id, entry.date)

    message = {
        "type": "production_entry_approved",
        "entry_id": entry.id,
        "date": entry.date.isoformat(),
    }
    asyncio.create_task(notification_manager.send_personal_message(message, entry.user_id))
    if entry.user.fcm_token:
        asyncio.create_task(send_fcm_notification(
            token=entry.user.fcm_token,
            title="Запись о продукции подтверждена",
            body=f"Запись за {entry.date.isoformat()} подтверждена",
            data=message,
            sender_id=current_user.id,
        ))

    return _entry_to_schema(entry, current_user, base_hours, overtime_hours, text_value)


@router.post("/production/entry/{entry_id}/reject", response_model=ProductionEntrySchema)
async def reject_production_entry(
    entry_id: int,
    data: ProductionEntryReject,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Отклоняет запись - комментарий обязателен (правило 11)."""
    entry = await _load_entry(db, entry_id)
    if not can_review_production(current_user, entry.user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if entry.status != PRODUCTION_STATUS_PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Entry is not pending approval")

    entry.status = PRODUCTION_STATUS_REJECTED
    entry.reviewer_id = current_user.id
    entry.reviewed_at = datetime.now(timezone.utc)
    entry.reviewer_comment = data.comment

    db.add(ProductionAuditLogModel(
        entry_id=entry.id, actor_id=current_user.id, action="rejected", comment=data.comment
    ))
    await db.commit()

    entry = await _load_entry(db, entry.id)
    base_hours, overtime_hours = await _get_hours_for_date(db, entry.user_id, entry.date)

    message = {
        "type": "production_entry_rejected",
        "entry_id": entry.id,
        "date": entry.date.isoformat(),
        "comment": data.comment,
    }
    asyncio.create_task(notification_manager.send_personal_message(message, entry.user_id))
    if entry.user.fcm_token:
        asyncio.create_task(send_fcm_notification(
            token=entry.user.fcm_token,
            title="Запись о продукции отклонена",
            body=data.comment,
            data=message,
            sender_id=current_user.id,
        ))

    return _entry_to_schema(entry, current_user, base_hours, overtime_hours)


# ------------------------------------------------------------------
# Экспорт в Excel
# ------------------------------------------------------------------

@router.get("/{user_id}/export")
async def export_timesheet_excel(
    user_id: int,
    year: int,
    month: int,
    current_user: UserModel = Depends(get_current_production_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Выгружает табель и сданную продукцию пользователя за месяц в Excel
    (два листа: "Табель" и "Продукция").
    """
    from openpyxl import Workbook

    target = await _get_user_or_404(db, user_id)
    if not can_view_timesheet(current_user, target):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this timesheet")

    start, end = _month_bounds(year, month)

    hours_result = await db.execute(
        select(TimesheetEntryModel).where(
            TimesheetEntryModel.user_id == user_id,
            TimesheetEntryModel.date >= start,
            TimesheetEntryModel.date <= end,
        )
    )
    hours_by_date = {e.date: (e.hours, e.overtime_hours) for e in hours_result.scalars().all()}

    entries_result = await db.execute(
        select(ProductionEntryModel)
        .options(selectinload(ProductionEntryModel.items).selectinload(ProductionEntryItemModel.product))
        .where(
            ProductionEntryModel.user_id == user_id,
            ProductionEntryModel.date >= start,
            ProductionEntryModel.date <= end,
        )
    )
    entries_by_date = {e.date: e for e in entries_result.scalars().all()}

    status_labels = {
        PRODUCTION_STATUS_DRAFT: "Черновик",
        PRODUCTION_STATUS_PENDING: "На согласовании",
        PRODUCTION_STATUS_APPROVED: "Подтверждено",
        PRODUCTION_STATUS_REJECTED: "Отклонено",
    }

    products_total = sum(
        (item.quantity for entry in entries_by_date.values() for item in entry.items),
        Decimal("0"),
    )

    wb = Workbook()
    ws_timesheet = wb.active
    ws_timesheet.title = "Табель"
    _fill_timesheet_grid_sheet(ws_timesheet, year, month, [{
        "number": 1,
        "tab_number": target.id,
        "grade": get_table_role_label(target.role),
        "fio": _user_name(target),
        "hours_by_date": hours_by_date,
        "products_total": products_total,
    }])

    ws_production = wb.create_sheet("Продукция")
    ws_production.append(["Дата", "Часы", "Продукция", "Количество", "Статус", "Комментарий сотрудника", "Комментарий руководителя"])
    for day_num in range(1, end.day + 1):
        day = date(year, month, day_num)
        base_hours, overtime_hours = hours_by_date.get(day, (Decimal("0"), Decimal("0")))
        hours = base_hours + overtime_hours
        entry = entries_by_date.get(day)
        if entry is None or not entry.items:
            ws_production.append([day.isoformat(), float(hours), "", "", "", "", ""])
            continue
        for item in entry.items:
            ws_production.append([
                day.isoformat(),
                float(hours),
                item.product.name if item.product else "",
                float(item.quantity),
                status_labels.get(entry.status, entry.status),
                item.comment or "",
                entry.reviewer_comment or "",
            ])

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    employee_name = _user_name(target)
    filename = f"timesheet_{employee_name or target.id}_{year}_{month:02d}.xlsx".replace(" ", "_")

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
