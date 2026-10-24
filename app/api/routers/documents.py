import io
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_async_db
from app.core.auth import get_current_user
from app.core.roles import ROLE_OWNER, ROLE_ADMIN
from app.core.notifications import dispatch_notification
from app.api.routers.notifications import manager as notification_manager
from app.utils import storage
from app.models.users import User as UserModel
from app.models.structure import Workshop as WorkshopModel, Section as SectionModel
from app.models.documents import (
    DocumentCategory as DocumentCategoryModel,
    Document as DocumentModel,
    DocumentApproval as DocumentApprovalModel,
    DocumentAssignment as DocumentAssignmentModel,
    DocumentImage as DocumentImageModel,
    DOCUMENT_STATUS_DRAFT,
    DOCUMENT_STATUS_PENDING_APPROVAL,
    DOCUMENT_STATUS_APPROVED,
    DOCUMENT_STATUS_REJECTED,
    DOCUMENT_STATUS_SENT,
    DOCUMENT_APPROVAL_STATUS_PENDING,
    DOCUMENT_APPROVAL_STATUS_APPROVED,
    DOCUMENT_APPROVAL_STATUS_REJECTED,
    DOCUMENT_ASSIGNMENT_STATUS_PENDING,
    DOCUMENT_ASSIGNMENT_STATUS_CONFIRMED,
    DOCUMENT_TARGET_USER,
    DOCUMENT_TARGET_SECTION,
    DOCUMENT_TARGET_WORKSHOP,
)
from app.schemas.documents import (
    DocumentCategoryCreate,
    DocumentCategoryUpdate,
    DocumentCategory as DocumentCategorySchema,
    DocumentCreate,
    DocumentUpdate,
    Document as DocumentSchema,
    DocumentImage as DocumentImageSchema,
    DocumentApproversSet,
    DocumentApproveRequest,
    DocumentRejectRequest,
    DocumentAssignRequest,
    DocumentAssignment as DocumentAssignmentSchema,
    DocumentApproval as DocumentApprovalSchema,
    DocumentApprovalReport,
    DocumentReport,
    DocumentReportItem,
)

# Допустимые типы изображений для фото/сканов документа (как у новостей).
DOCUMENT_IMAGE_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
# Ограничение на размер одного файла фото/скана (10 МБ).
DOCUMENT_IMAGE_MAX_SIZE = 10 * 1024 * 1024
# Максимум фотографий на один документ.
DOCUMENT_IMAGE_MAX_COUNT = 20

# Руководители (аналогично объявлениям) - могут создавать категории,
# документы, назначать подписантов и получателей. Рядовой сотрудник
# документов не создаёт, но может быть назначен подписантом либо получателем.
ALLOWED_DOCUMENT_MANAGER_ROLES = {
    ROLE_OWNER,
    ROLE_ADMIN,
    "shop_chief",
    "section_chief",
    "master",
    "assistant_master",
}

category_router = APIRouter(prefix="/document-categories", tags=["documents"])
router = APIRouter(prefix="/documents", tags=["documents"])
my_router = APIRouter(prefix="/my", tags=["documents"])


def _is_manager(user: UserModel) -> bool:
    return user.role in ALLOWED_DOCUMENT_MANAGER_ROLES


def _require_manager(user: UserModel) -> None:
    if not _is_manager(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только руководитель может выполнять это действие",
        )


def _user_name(user: UserModel) -> str:
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or user.email or user.phone_number or f"#{user.id}"


# --------------------------------------------------------------------------
# Категории документов
# --------------------------------------------------------------------------
@category_router.get("/", response_model=list[DocumentCategorySchema])
async def list_document_categories(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Список категорий документов (доступен всем авторизованным пользователям)."""
    count_sub = (
        select(func.count(DocumentModel.id))
        .where(DocumentModel.category_id == DocumentCategoryModel.id)
        .correlate(DocumentCategoryModel)
        .scalar_subquery()
    )
    result = await db.execute(
        select(DocumentCategoryModel, count_sub).order_by(DocumentCategoryModel.title.asc())
    )
    categories = []
    for row in result.all():
        item = DocumentCategorySchema.model_validate(row[0])
        item.documents_count = row[1] or 0
        categories.append(item)
    return categories


@category_router.post("/", response_model=DocumentCategorySchema, status_code=status.HTTP_201_CREATED)
async def create_document_category(
    data: DocumentCategoryCreate,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    _require_manager(current_user)
    category = DocumentCategoryModel(title=data.title, description=data.description)
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return DocumentCategorySchema.model_validate(category)


@category_router.patch("/{category_id}", response_model=DocumentCategorySchema)
async def update_document_category(
    category_id: int,
    data: DocumentCategoryUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    _require_manager(current_user)
    result = await db.execute(select(DocumentCategoryModel).where(DocumentCategoryModel.id == category_id))
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Категория не найдена")

    if data.title is not None:
        category.title = data.title
    if data.description is not None:
        category.description = data.description
    await db.commit()
    await db.refresh(category)
    return DocumentCategorySchema.model_validate(category)


@category_router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document_category(
    category_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    _require_manager(current_user)
    result = await db.execute(select(DocumentCategoryModel).where(DocumentCategoryModel.id == category_id))
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Категория не найдена")

    docs_count = await db.scalar(
        select(func.count(DocumentModel.id)).where(DocumentModel.category_id == category_id)
    )
    if docs_count:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя удалить категорию, в которой есть документы",
        )

    await db.delete(category)
    await db.commit()
    return None


# --------------------------------------------------------------------------
# Вспомогательные функции для документов
# --------------------------------------------------------------------------
async def _load_document(db: AsyncSession, document_id: int) -> DocumentModel:
    result = await db.execute(
        select(DocumentModel)
        .options(
            selectinload(DocumentModel.category),
            selectinload(DocumentModel.author),
            selectinload(DocumentModel.images),
        )
        .where(DocumentModel.id == document_id)
    )
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Документ не найден")
    return document


async def _can_view_document(db: AsyncSession, document: DocumentModel, user: UserModel) -> bool:
    if document.created_by_user_id == user.id or user.role in (ROLE_OWNER, ROLE_ADMIN):
        return True
    approval = await db.scalar(
        select(DocumentApprovalModel).where(
            DocumentApprovalModel.document_id == document.id,
            DocumentApprovalModel.approver_user_id == user.id,
        )
    )
    if approval is not None:
        return True
    assignment = await db.scalar(
        select(DocumentAssignmentModel).where(
            DocumentAssignmentModel.document_id == document.id,
            DocumentAssignmentModel.assigned_to_user_id == user.id,
        )
    )
    return assignment is not None


async def _build_document_schema(db: AsyncSession, document: DocumentModel, current_user: UserModel) -> DocumentSchema:
    approvers_count = await db.scalar(
        select(func.count(DocumentApprovalModel.id)).where(
            DocumentApprovalModel.document_id == document.id,
            DocumentApprovalModel.document_version == document.version,
        )
    )
    approved_count = await db.scalar(
        select(func.count(DocumentApprovalModel.id)).where(
            DocumentApprovalModel.document_id == document.id,
            DocumentApprovalModel.document_version == document.version,
            DocumentApprovalModel.status == DOCUMENT_APPROVAL_STATUS_APPROVED,
        )
    )
    assignees_count = await db.scalar(
        select(func.count(DocumentAssignmentModel.id)).where(DocumentAssignmentModel.document_id == document.id)
    )
    confirmed_count = await db.scalar(
        select(func.count(DocumentAssignmentModel.id)).where(
            DocumentAssignmentModel.document_id == document.id,
            DocumentAssignmentModel.status == DOCUMENT_ASSIGNMENT_STATUS_CONFIRMED,
        )
    )

    item = DocumentSchema.model_validate(document)
    item.approvers_count = approvers_count or 0
    item.approved_count = approved_count or 0
    item.assignees_count = assignees_count or 0
    item.confirmed_count = confirmed_count or 0

    my_approval = await db.scalar(
        select(DocumentApprovalModel).where(
            DocumentApprovalModel.document_id == document.id,
            DocumentApprovalModel.approver_user_id == current_user.id,
            DocumentApprovalModel.document_version == document.version,
        )
    )
    if my_approval is not None:
        item.my_approval_status = my_approval.status

    my_assignment = await db.scalar(
        select(DocumentAssignmentModel).where(
            DocumentAssignmentModel.document_id == document.id,
            DocumentAssignmentModel.assigned_to_user_id == current_user.id,
        )
    )
    if my_assignment is not None:
        item.my_assignment_status = my_assignment.status

    return item


def _document_ready_for_assignment(document: DocumentModel) -> bool:
    if document.approval_required:
        return document.status in (DOCUMENT_STATUS_APPROVED, DOCUMENT_STATUS_SENT)
    return document.status in (DOCUMENT_STATUS_DRAFT, DOCUMENT_STATUS_APPROVED, DOCUMENT_STATUS_SENT)


# --------------------------------------------------------------------------
# CRUD документов
# --------------------------------------------------------------------------
@router.post("/", response_model=DocumentSchema, status_code=status.HTTP_201_CREATED)
async def create_document(
    data: DocumentCreate,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Создаёт документ как черновик. Подписанты (approver_ids) опциональны."""
    _require_manager(current_user)

    category = await db.scalar(select(DocumentCategoryModel).where(DocumentCategoryModel.id == data.category_id))
    if not category:
        raise HTTPException(status_code=404, detail="Категория не найдена")

    document = DocumentModel(
        category_id=data.category_id,
        title=data.title,
        description=data.description,
        file_url=data.file_url,
        content=data.content,
        confirmation_button_text=data.confirmation_button_text or "Ознакомлен",
        created_by_user_id=current_user.id,
        status=DOCUMENT_STATUS_DRAFT,
    )
    db.add(document)
    await db.flush()

    approver_ids = sorted(set(data.approver_ids or []))
    if approver_ids:
        document.approval_required = True
        for approver_id in approver_ids:
            db.add(DocumentApprovalModel(
                document_id=document.id,
                approver_user_id=approver_id,
                document_version=document.version,
                status=DOCUMENT_APPROVAL_STATUS_PENDING,
            ))

    await db.commit()
    document = await _load_document(db, document.id)
    return await _build_document_schema(db, document, current_user)


@router.get("/", response_model=list[DocumentSchema])
async def list_documents(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Список документов: админ/владелец видят все, остальные руководители - только свои."""
    _require_manager(current_user)

    query = (
        select(DocumentModel)
        .options(
            selectinload(DocumentModel.category),
            selectinload(DocumentModel.author),
            selectinload(DocumentModel.images),
        )
        .order_by(DocumentModel.created_at.desc())
    )
    if current_user.role not in (ROLE_OWNER, ROLE_ADMIN):
        query = query.where(DocumentModel.created_by_user_id == current_user.id)

    result = await db.execute(query)
    documents = result.scalars().all()
    return [await _build_document_schema(db, d, current_user) for d in documents]


@router.get("/approval/inbox", response_model=list[DocumentSchema])
async def get_approval_inbox(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Документы, ожидающие согласования текущим пользователем как подписантом."""
    result = await db.execute(
        select(DocumentModel)
        .join(
            DocumentApprovalModel,
            (DocumentApprovalModel.document_id == DocumentModel.id)
            & (DocumentApprovalModel.document_version == DocumentModel.version),
        )
        .options(
            selectinload(DocumentModel.category),
            selectinload(DocumentModel.author),
            selectinload(DocumentModel.images),
        )
        .where(
            DocumentApprovalModel.approver_user_id == current_user.id,
            DocumentApprovalModel.status == DOCUMENT_APPROVAL_STATUS_PENDING,
            DocumentModel.status == DOCUMENT_STATUS_PENDING_APPROVAL,
        )
        .order_by(DocumentModel.approval_started_at.desc())
    )
    documents = result.unique().scalars().all()
    return [await _build_document_schema(db, d, current_user) for d in documents]


@router.get("/{document_id}", response_model=DocumentSchema)
async def get_document_detail(
    document_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    document = await _load_document(db, document_id)
    if not await _can_view_document(db, document, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к документу")
    return await _build_document_schema(db, document, current_user)


@router.patch("/{document_id}", response_model=DocumentSchema)
async def update_document(
    document_id: int,
    data: DocumentUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    document = await _load_document(db, document_id)
    if document.created_by_user_id != current_user.id and current_user.role not in (ROLE_OWNER, ROLE_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Редактировать может только автор документа")
    if document.status not in (DOCUMENT_STATUS_DRAFT, DOCUMENT_STATUS_REJECTED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Редактировать можно только черновик или отклонённый документ",
        )

    if data.category_id is not None:
        category = await db.scalar(select(DocumentCategoryModel).where(DocumentCategoryModel.id == data.category_id))
        if not category:
            raise HTTPException(status_code=404, detail="Категория не найдена")
        document.category_id = data.category_id
    if data.title is not None:
        document.title = data.title
    if data.description is not None:
        document.description = data.description
    if data.file_url is not None:
        document.file_url = data.file_url
    if data.content is not None:
        document.content = data.content
    if data.confirmation_button_text is not None:
        document.confirmation_button_text = data.confirmation_button_text

    await db.commit()
    document = await _load_document(db, document.id)
    return await _build_document_schema(db, document, current_user)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    document = await _load_document(db, document_id)
    if document.created_by_user_id != current_user.id and current_user.role not in (ROLE_OWNER, ROLE_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Удалить может только автор документа")

    if document.file_url:
        try:
            from app.utils import storage as storage_service
            storage_service.delete("documents", document.file_url)
        except Exception:
            pass

    for image in document.images:
        try:
            storage.delete("documents", image.image_url)
            if image.thumbnail_url and image.thumbnail_url != image.image_url:
                storage.delete("documents", image.thumbnail_url)
        except Exception:
            pass

    await db.delete(document)
    await db.commit()
    return None


# --------------------------------------------------------------------------
# Фотографии/сканы документа
# --------------------------------------------------------------------------
async def _save_document_image(file: UploadFile) -> tuple[str, str]:
    """Сохраняет одно фото/скан документа и генерирует превью (по аналогии с новостями)."""
    if file.content_type not in DOCUMENT_IMAGE_ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Допустимы только изображения JPG, PNG или WebP")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail=f"Файл {file.filename} пуст")
    if len(content) > DOCUMENT_IMAGE_MAX_SIZE:
        raise HTTPException(status_code=400, detail=f"Изображение {file.filename} слишком большое (>10МБ)")

    extension = Path(file.filename or "").suffix.lower() or ".jpg"
    base_name = str(uuid.uuid4())

    original_url, _ = storage.save_file(
        category="documents",
        filename_hint=f"{base_name}{extension}",
        fileobj=io.BytesIO(content),
        content_type=file.content_type or "image/jpeg",
        private=False,
    )

    thumb_url = original_url
    try:
        with Image.open(io.BytesIO(content)) as img:
            img.thumbnail((400, 400))
            thumb_buffer = io.BytesIO()
            if extension in (".jpg", ".jpeg"):
                fmt = "JPEG"
            elif extension == ".png":
                fmt = "PNG"
            elif extension == ".webp":
                fmt = "WEBP"
            else:
                fmt = img.format or "PNG"
            try:
                img.save(thumb_buffer, format=fmt)
                thumb_buffer.seek(0)
                thumb_url, _ = storage.save_file(
                    category="documents",
                    filename_hint=f"{base_name}_thumb{extension}",
                    fileobj=thumb_buffer,
                    content_type=file.content_type or "image/jpeg",
                    private=False,
                )
            except Exception:
                thumb_url = original_url
    except Exception:
        thumb_url = original_url

    return original_url, thumb_url


@router.post("/{document_id}/images", response_model=list[DocumentImageSchema], status_code=status.HTTP_201_CREATED)
async def upload_document_images(
    document_id: int,
    images: list[UploadFile] = File(...),
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Загружает одну или несколько фотографий/сканов документа (например, сканы
    бумажного документа). Доступно автору документа и администрации, пока
    документ остаётся черновиком или отклонённым (как и прочее редактирование).
    """
    document = await _load_document(db, document_id)
    if document.created_by_user_id != current_user.id and current_user.role not in (ROLE_OWNER, ROLE_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Добавлять фото может только автор документа")
    if document.status not in (DOCUMENT_STATUS_DRAFT, DOCUMENT_STATUS_REJECTED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Добавлять фото можно только к черновику или отклонённому документу",
        )

    files = [img for img in (images or []) if getattr(img, "filename", None)]
    if not files:
        raise HTTPException(status_code=400, detail="Не переданы файлы изображений")
    if len(document.images) + len(files) > DOCUMENT_IMAGE_MAX_COUNT:
        raise HTTPException(
            status_code=400,
            detail=f"Превышен лимит фотографий на документ ({DOCUMENT_IMAGE_MAX_COUNT})",
        )

    new_images: list[DocumentImageModel] = []
    for file in files:
        image_url, thumbnail_url = await _save_document_image(file)
        db_image = DocumentImageModel(
            document_id=document.id,
            image_url=image_url,
            thumbnail_url=thumbnail_url,
        )
        db.add(db_image)
        new_images.append(db_image)

    await db.commit()
    for img in new_images:
        await db.refresh(img)
    return new_images


@router.delete("/{document_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document_image(
    document_id: int,
    image_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Удаляет одно фото/скан документа."""
    document = await _load_document(db, document_id)
    if document.created_by_user_id != current_user.id and current_user.role not in (ROLE_OWNER, ROLE_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Удалять фото может только автор документа")
    if document.status not in (DOCUMENT_STATUS_DRAFT, DOCUMENT_STATUS_REJECTED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Удалять фото можно только у черновика или отклонённого документа",
        )

    image = await db.scalar(
        select(DocumentImageModel).where(
            DocumentImageModel.id == image_id,
            DocumentImageModel.document_id == document.id,
        )
    )
    if not image:
        raise HTTPException(status_code=404, detail="Изображение не найдено")

    try:
        storage.delete("documents", image.image_url)
        if image.thumbnail_url and image.thumbnail_url != image.image_url:
            storage.delete("documents", image.thumbnail_url)
    except Exception:
        pass

    await db.delete(image)
    await db.commit()
    return None


# --------------------------------------------------------------------------
# Согласование подписантами
# --------------------------------------------------------------------------
@router.post("/{document_id}/approvers", response_model=DocumentSchema)
async def set_document_approvers(
    document_id: int,
    data: DocumentApproversSet,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Назначает (полностью заменяет) подписантов документа на текущую версию документа."""
    document = await _load_document(db, document_id)
    if document.created_by_user_id != current_user.id and current_user.role not in (ROLE_OWNER, ROLE_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только автор может назначать подписантов")
    if document.status not in (DOCUMENT_STATUS_DRAFT, DOCUMENT_STATUS_REJECTED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Назначать подписантов можно только для черновика или отклонённого документа",
        )

    # Удаляем предыдущие ещё не отправленные записи текущей версии, чтобы
    # избежать дублирования подписантов при повторном вызове.
    existing = await db.execute(
        select(DocumentApprovalModel).where(
            DocumentApprovalModel.document_id == document.id,
            DocumentApprovalModel.document_version == document.version,
        )
    )
    for row in existing.scalars().all():
        await db.delete(row)
    await db.flush()

    approver_ids = sorted(set(data.approver_ids or []))
    if approver_ids:
        users_res = await db.execute(select(UserModel.id).where(UserModel.id.in_(approver_ids)))
        found_ids = {r[0] for r in users_res.all()}
        missing = set(approver_ids) - found_ids
        if missing:
            raise HTTPException(status_code=404, detail=f"Пользователи не найдены: {sorted(missing)}")

        for approver_id in approver_ids:
            db.add(DocumentApprovalModel(
                document_id=document.id,
                approver_user_id=approver_id,
                document_version=document.version,
                status=DOCUMENT_APPROVAL_STATUS_PENDING,
            ))
    document.approval_required = bool(approver_ids)

    await db.commit()
    document = await _load_document(db, document.id)
    return await _build_document_schema(db, document, current_user)


@router.post("/{document_id}/submit-for-approval", response_model=DocumentSchema)
async def submit_document_for_approval(
    document_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Отправляет документ на согласование назначенным подписантам."""
    document = await _load_document(db, document_id)
    if document.created_by_user_id != current_user.id and current_user.role not in (ROLE_OWNER, ROLE_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только автор может отправить на согласование")
    if document.status not in (DOCUMENT_STATUS_DRAFT, DOCUMENT_STATUS_REJECTED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="На согласование можно отправить только черновик или отклонённый документ",
        )
    if not document.approval_required:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="У документа не назначены подписанты - используйте POST /documents/{id}/approvers",
        )

    was_rejected = document.status == DOCUMENT_STATUS_REJECTED
    if was_rejected:
        # Новая попытка согласования после правок - собираем тех же
        # подписантов и заводим для них решения новой версии документа.
        prev_res = await db.execute(
            select(DocumentApprovalModel.approver_user_id)
            .where(
                DocumentApprovalModel.document_id == document.id,
                DocumentApprovalModel.document_version == document.version,
            )
            .distinct()
        )
        approver_ids = [r[0] for r in prev_res.all()]
        document.version += 1
        for approver_id in approver_ids:
            db.add(DocumentApprovalModel(
                document_id=document.id,
                approver_user_id=approver_id,
                document_version=document.version,
                status=DOCUMENT_APPROVAL_STATUS_PENDING,
            ))
        await db.flush()

    approvals_res = await db.execute(
        select(DocumentApprovalModel)
        .options(selectinload(DocumentApprovalModel.approver))
        .where(
            DocumentApprovalModel.document_id == document.id,
            DocumentApprovalModel.document_version == document.version,
        )
    )
    approvals = approvals_res.scalars().all()
    if not approvals:
        raise HTTPException(status_code=400, detail="У документа не назначены подписанты")

    now = datetime.now(timezone.utc)
    document.status = DOCUMENT_STATUS_PENDING_APPROVAL
    document.approval_started_at = now
    document.approval_completed_at = None
    document.rejected_at = None

    author_name = _user_name(current_user)
    for approval in approvals:
        approval.requested_at = now
        notification_msg = {
            "type": "document_approval_request",
            "document_id": document.id,
            "document_title": document.title,
        }
        dispatch_notification(
            approval.approver,
            group="document_approval",
            title="Документ на согласование" if not was_rejected else "Документ повторно на согласовании",
            body=f"{author_name}: {document.title}",
            data=notification_msg,
            sender_id=current_user.id,
            ws_manager=notification_manager,
            ws_message=notification_msg,
        )

    await db.commit()
    document = await _load_document(db, document.id)
    return await _build_document_schema(db, document, current_user)


async def _get_my_pending_approval(db: AsyncSession, document: DocumentModel, user: UserModel) -> DocumentApprovalModel:
    approval = await db.scalar(
        select(DocumentApprovalModel).where(
            DocumentApprovalModel.document_id == document.id,
            DocumentApprovalModel.approver_user_id == user.id,
            DocumentApprovalModel.document_version == document.version,
        )
    )
    if approval is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Вы не являетесь подписантом этого документа")
    if approval.status != DOCUMENT_APPROVAL_STATUS_PENDING:
        raise HTTPException(status_code=400, detail="Решение по этому документу уже принято")
    return approval


@router.post("/{document_id}/approve", response_model=DocumentSchema)
async def approve_document(
    document_id: int,
    data: DocumentApproveRequest,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    document = await _load_document(db, document_id)
    if document.status != DOCUMENT_STATUS_PENDING_APPROVAL:
        raise HTTPException(status_code=400, detail="Документ не находится на согласовании")
    approval = await _get_my_pending_approval(db, document, current_user)

    now = datetime.now(timezone.utc)
    approval.status = DOCUMENT_APPROVAL_STATUS_APPROVED
    approval.approved_at = now
    approval.comment = data.comment

    remaining = await db.scalar(
        select(func.count(DocumentApprovalModel.id)).where(
            DocumentApprovalModel.document_id == document.id,
            DocumentApprovalModel.document_version == document.version,
            DocumentApprovalModel.status != DOCUMENT_APPROVAL_STATUS_APPROVED,
        )
    )
    if not remaining:
        document.status = DOCUMENT_STATUS_APPROVED
        document.approval_completed_at = now
        author = await db.scalar(select(UserModel).where(UserModel.id == document.created_by_user_id))
        if author:
            notification_msg = {"type": "document_approved", "document_id": document.id, "document_title": document.title}
            dispatch_notification(
                author,
                group="document_approval",
                title="Документ согласован",
                body=f"Документ «{document.title}» согласован всеми подписантами",
                data=notification_msg,
                ws_manager=notification_manager,
                ws_message=notification_msg,
            )

    await db.commit()
    document = await _load_document(db, document.id)
    return await _build_document_schema(db, document, current_user)


@router.post("/{document_id}/reject", response_model=DocumentSchema)
async def reject_document(
    document_id: int,
    data: DocumentRejectRequest,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    document = await _load_document(db, document_id)
    if document.status != DOCUMENT_STATUS_PENDING_APPROVAL:
        raise HTTPException(status_code=400, detail="Документ не находится на согласовании")
    approval = await _get_my_pending_approval(db, document, current_user)

    now = datetime.now(timezone.utc)
    approval.status = DOCUMENT_APPROVAL_STATUS_REJECTED
    approval.rejected_at = now
    approval.comment = data.comment

    document.status = DOCUMENT_STATUS_REJECTED
    document.rejected_at = now

    author = await db.scalar(select(UserModel).where(UserModel.id == document.created_by_user_id))
    if author:
        approver_name = _user_name(current_user)
        notification_msg = {
            "type": "document_rejected",
            "document_id": document.id,
            "document_title": document.title,
            "comment": data.comment,
        }
        dispatch_notification(
            author,
            group="document_approval",
            title="Документ отклонён",
            body=f"{approver_name} отклонил(а) документ «{document.title}»: {data.comment[:100]}",
            data=notification_msg,
            sender_id=current_user.id,
            ws_manager=notification_manager,
            ws_message=notification_msg,
        )

    await db.commit()
    document = await _load_document(db, document.id)
    return await _build_document_schema(db, document, current_user)


@router.get("/{document_id}/approval-report", response_model=DocumentApprovalReport)
async def get_document_approval_report(
    document_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    document = await _load_document(db, document_id)
    if document.created_by_user_id != current_user.id and current_user.role not in (ROLE_OWNER, ROLE_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступен только автору документа")

    result = await db.execute(
        select(DocumentApprovalModel)
        .options(selectinload(DocumentApprovalModel.approver))
        .where(
            DocumentApprovalModel.document_id == document.id,
            DocumentApprovalModel.document_version == document.version,
        )
        .order_by(DocumentApprovalModel.id.asc())
    )
    approvals = result.scalars().all()
    approved = sum(1 for a in approvals if a.status == DOCUMENT_APPROVAL_STATUS_APPROVED)
    rejected = sum(1 for a in approvals if a.status == DOCUMENT_APPROVAL_STATUS_REJECTED)
    pending = sum(1 for a in approvals if a.status == DOCUMENT_APPROVAL_STATUS_PENDING)

    return DocumentApprovalReport(
        document_id=document.id,
        document_title=document.title,
        status=document.status,
        document_version=document.version,
        total=len(approvals),
        approved_count=approved,
        rejected_count=rejected,
        pending_count=pending,
        approvals=[DocumentApprovalSchema.model_validate(a) for a in approvals],
    )


@router.post("/{document_id}/approval-remind")
async def remind_approvers(
    document_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    document = await _load_document(db, document_id)
    if document.created_by_user_id != current_user.id and current_user.role not in (ROLE_OWNER, ROLE_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступен только автору документа")
    if document.status != DOCUMENT_STATUS_PENDING_APPROVAL:
        raise HTTPException(status_code=400, detail="Документ не находится на согласовании")

    result = await db.execute(
        select(DocumentApprovalModel)
        .options(selectinload(DocumentApprovalModel.approver))
        .where(
            DocumentApprovalModel.document_id == document.id,
            DocumentApprovalModel.document_version == document.version,
            DocumentApprovalModel.status == DOCUMENT_APPROVAL_STATUS_PENDING,
        )
    )
    pending_approvals = result.scalars().all()
    now = datetime.now(timezone.utc)
    author_name = _user_name(current_user)
    for approval in pending_approvals:
        approval.last_reminder_at = now
        notification_msg = {"type": "document_approval_reminder", "document_id": document.id, "document_title": document.title}
        dispatch_notification(
            approval.approver,
            group="document_approval",
            title="Напоминание: необходимо согласовать документ",
            body=f"{author_name}: {document.title}",
            data=notification_msg,
            sender_id=current_user.id,
            ws_manager=notification_manager,
            ws_message=notification_msg,
        )

    await db.commit()
    return {"status": "ok", "reminded_count": len(pending_approvals)}


# --------------------------------------------------------------------------
# Назначение документа получателям и ознакомление
# --------------------------------------------------------------------------
async def _resolve_assignment_recipients(db: AsyncSession, data: DocumentAssignRequest) -> list[UserModel]:
    """
    Разворачивает выбранные цеха/отделы/пользователей в итоговый набор
    пользователей без дублей (один и тот же пользователь, выбранный
    несколькими способами, попадёт в выдачу один раз).
    """
    recipients: dict[int, UserModel] = {}

    if data.workshop_ids:
        ws_res = await db.execute(select(WorkshopModel.id).where(WorkshopModel.id.in_(data.workshop_ids)))
        found_ws = {r[0] for r in ws_res.all()}
        missing = set(data.workshop_ids) - found_ws
        if missing:
            raise HTTPException(status_code=404, detail=f"Цеха не найдены: {sorted(missing)}")
        users_res = await db.execute(
            select(UserModel).where(UserModel.workshop_id.in_(data.workshop_ids), UserModel.is_active == True)
        )
        for u in users_res.scalars().all():
            recipients[u.id] = u

    if data.section_ids:
        sec_res = await db.execute(select(SectionModel.id).where(SectionModel.id.in_(data.section_ids)))
        found_sec = {r[0] for r in sec_res.all()}
        missing = set(data.section_ids) - found_sec
        if missing:
            raise HTTPException(status_code=404, detail=f"Отделы/участки не найдены: {sorted(missing)}")
        users_res = await db.execute(
            select(UserModel).where(UserModel.section_id.in_(data.section_ids), UserModel.is_active == True)
        )
        for u in users_res.scalars().all():
            recipients[u.id] = u

    if data.user_ids:
        users_res = await db.execute(
            select(UserModel).where(UserModel.id.in_(data.user_ids), UserModel.is_active == True)
        )
        found = users_res.scalars().all()
        found_ids = {u.id for u in found}
        missing = set(data.user_ids) - found_ids
        if missing:
            raise HTTPException(status_code=404, detail=f"Пользователи не найдены: {sorted(missing)}")
        for u in found:
            recipients[u.id] = u

    return list(recipients.values())


@router.post("/{document_id}/assign", response_model=list[DocumentAssignmentSchema])
async def assign_document(
    document_id: int,
    data: DocumentAssignRequest,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Назначает документ на ознакомление пользователям/отделам/цехам."""
    document = await _load_document(db, document_id)
    if document.created_by_user_id != current_user.id and current_user.role not in (ROLE_OWNER, ROLE_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только автор может отправить документ на ознакомление")

    if not _document_ready_for_assignment(document):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Документ требует согласования и ещё не согласован всеми подписантами",
        )

    if not (data.user_ids or data.section_ids or data.workshop_ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Не выбраны получатели")

    recipients = await _resolve_assignment_recipients(db, data)
    if not recipients:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нет доступных получателей")

    existing_res = await db.execute(
        select(DocumentAssignmentModel.assigned_to_user_id).where(DocumentAssignmentModel.document_id == document.id)
    )
    already_assigned = {r[0] for r in existing_res.all()}

    def _target_info(user: UserModel) -> tuple[str, int | None]:
        if data.user_ids and user.id in set(data.user_ids):
            return DOCUMENT_TARGET_USER, None
        if data.section_ids and user.section_id in set(data.section_ids):
            return DOCUMENT_TARGET_SECTION, user.section_id
        if data.workshop_ids and user.workshop_id in set(data.workshop_ids):
            return DOCUMENT_TARGET_WORKSHOP, user.workshop_id
        return DOCUMENT_TARGET_USER, None

    created: list[DocumentAssignmentModel] = []
    author_name = _user_name(current_user)
    for user in recipients:
        if user.id in already_assigned:
            continue
        target_type, target_id = _target_info(user)
        assignment = DocumentAssignmentModel(
            document_id=document.id,
            assigned_to_user_id=user.id,
            assigned_by_user_id=current_user.id,
            target_type=target_type,
            target_id=target_id,
            status=DOCUMENT_ASSIGNMENT_STATUS_PENDING,
        )
        db.add(assignment)
        created.append(assignment)

        notification_msg = {
            "type": "document_assigned",
            "document_id": document.id,
            "document_title": document.title,
        }
        dispatch_notification(
            user,
            group="documents",
            title="Новый документ для ознакомления",
            body=f"{author_name}: {document.title}",
            data=notification_msg,
            sender_id=current_user.id,
            ws_manager=notification_manager,
            ws_message=notification_msg,
        )

    document.status = DOCUMENT_STATUS_SENT
    await db.commit()

    result = await db.execute(
        select(DocumentAssignmentModel)
        .options(selectinload(DocumentAssignmentModel.assigned_to), selectinload(DocumentAssignmentModel.document))
        .where(DocumentAssignmentModel.id.in_([a.id for a in created]))
    )
    return [DocumentAssignmentSchema.model_validate(a) for a in result.scalars().all()]


@my_router.get("/documents", response_model=list[DocumentAssignmentSchema])
async def get_my_documents(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Личная папка пользователя - документы, назначенные ему на ознакомление."""
    result = await db.execute(
        select(DocumentAssignmentModel)
        .options(
            selectinload(DocumentAssignmentModel.document).selectinload(DocumentModel.category),
        )
        .where(DocumentAssignmentModel.assigned_to_user_id == current_user.id)
        .order_by(DocumentAssignmentModel.assigned_at.desc())
    )
    return [DocumentAssignmentSchema.model_validate(a) for a in result.scalars().all()]


@router.post("/{document_id}/confirm", response_model=DocumentAssignmentSchema)
async def confirm_document(
    document_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Подтверждает ознакомление с документом. Повторное нажатие не создаёт дублей."""
    result = await db.execute(
        select(DocumentAssignmentModel)
        .options(selectinload(DocumentAssignmentModel.document))
        .where(
            DocumentAssignmentModel.document_id == document_id,
            DocumentAssignmentModel.assigned_to_user_id == current_user.id,
        )
    )
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="Документ не назначен вам на ознакомление")

    if assignment.status != DOCUMENT_ASSIGNMENT_STATUS_CONFIRMED:
        assignment.status = DOCUMENT_ASSIGNMENT_STATUS_CONFIRMED
        assignment.confirmed_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(assignment)

    return DocumentAssignmentSchema.model_validate(assignment)


@router.get("/{document_id}/report", response_model=DocumentReport)
async def get_document_report(
    document_id: int,
    status_filter: str = "all",
    section_id: int | None = None,
    workshop_id: int | None = None,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Отчёт по ознакомлению: кто ознакомился, кто нет, с фильтрами."""
    document = await _load_document(db, document_id)
    if document.created_by_user_id != current_user.id and current_user.role not in (ROLE_OWNER, ROLE_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступен только автору документа")

    query = (
        select(DocumentAssignmentModel)
        .options(selectinload(DocumentAssignmentModel.assigned_to))
        .where(DocumentAssignmentModel.document_id == document_id)
    )
    if status_filter == "confirmed":
        query = query.where(DocumentAssignmentModel.status == DOCUMENT_ASSIGNMENT_STATUS_CONFIRMED)
    elif status_filter == "pending":
        query = query.where(DocumentAssignmentModel.status == DOCUMENT_ASSIGNMENT_STATUS_PENDING)

    if section_id is not None:
        query = query.join(UserModel, UserModel.id == DocumentAssignmentModel.assigned_to_user_id).where(
            UserModel.section_id == section_id
        )
    if workshop_id is not None:
        query = query.join(UserModel, UserModel.id == DocumentAssignmentModel.assigned_to_user_id).where(
            UserModel.workshop_id == workshop_id
        )

    result = await db.execute(query.order_by(DocumentAssignmentModel.assigned_at.asc()))
    assignments = result.unique().scalars().all()

    total_all = await db.scalar(
        select(func.count(DocumentAssignmentModel.id)).where(DocumentAssignmentModel.document_id == document_id)
    )
    confirmed_all = await db.scalar(
        select(func.count(DocumentAssignmentModel.id)).where(
            DocumentAssignmentModel.document_id == document_id,
            DocumentAssignmentModel.status == DOCUMENT_ASSIGNMENT_STATUS_CONFIRMED,
        )
    )

    items = [
        DocumentReportItem(
            id=a.id,
            user=a.assigned_to,
            status=a.status,
            assigned_at=a.assigned_at,
            confirmed_at=a.confirmed_at,
            last_reminder_at=a.last_reminder_at,
        )
        for a in assignments
    ]

    return DocumentReport(
        document_id=document.id,
        document_title=document.title,
        total=total_all or 0,
        confirmed_count=confirmed_all or 0,
        pending_count=(total_all or 0) - (confirmed_all or 0),
        items=items,
    )


@router.post("/{document_id}/remind")
async def remind_document(
    document_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Отправляет повторное уведомление пользователям, которые ещё не ознакомились."""
    document = await _load_document(db, document_id)
    if document.created_by_user_id != current_user.id and current_user.role not in (ROLE_OWNER, ROLE_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступен только автору документа")

    result = await db.execute(
        select(DocumentAssignmentModel)
        .options(selectinload(DocumentAssignmentModel.assigned_to))
        .where(
            DocumentAssignmentModel.document_id == document_id,
            DocumentAssignmentModel.status == DOCUMENT_ASSIGNMENT_STATUS_PENDING,
        )
    )
    pending = result.scalars().all()
    now = datetime.now(timezone.utc)
    author_name = _user_name(current_user)
    for assignment in pending:
        assignment.last_reminder_at = now
        notification_msg = {
            "type": "document_reminder",
            "document_id": document.id,
            "document_title": document.title,
        }
        dispatch_notification(
            assignment.assigned_to,
            group="documents",
            title="Напоминание: необходимо ознакомиться с документом",
            body=f"{author_name}: {document.title}",
            data=notification_msg,
            sender_id=current_user.id,
            ws_manager=notification_manager,
            ws_message=notification_msg,
        )

    await db.commit()
    return {"status": "ok", "reminded_count": len(pending)}
