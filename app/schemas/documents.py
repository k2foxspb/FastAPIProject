from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List


# --------------------------------------------------------------------------
# Категории документов (папки)
# --------------------------------------------------------------------------
class DocumentCategoryCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None


class DocumentCategoryUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None


class DocumentCategory(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    documents_count: int = 0
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------
# Общие вспомогательные схемы
# --------------------------------------------------------------------------
class DocumentUserBrief(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: Optional[str] = None
    workshop_id: Optional[int] = None
    section_id: Optional[int] = None
    avatar_url: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------
# Документы
# --------------------------------------------------------------------------
class DocumentCreate(BaseModel):
    category_id: int
    title: str = Field(min_length=1, max_length=300)
    description: Optional[str] = None
    file_url: Optional[str] = None
    content: Optional[str] = None
    confirmation_button_text: str = Field(min_length=1, max_length=100, default="Ознакомлен")
    approver_ids: Optional[List[int]] = Field(
        default=None, description="Подписанты, которые должны согласовать документ перед отправкой"
    )


class DocumentUpdate(BaseModel):
    category_id: Optional[int] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    description: Optional[str] = None
    file_url: Optional[str] = None
    content: Optional[str] = None
    confirmation_button_text: Optional[str] = Field(default=None, min_length=1, max_length=100)


class DocumentApproval(BaseModel):
    id: int
    document_id: int
    approver_user_id: int
    approver: Optional[DocumentUserBrief] = None
    document_version: int
    status: str
    comment: Optional[str] = None
    requested_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    rejected_at: Optional[datetime] = None
    last_reminder_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class Document(BaseModel):
    id: int
    category_id: int
    category_title: Optional[str] = None
    title: str
    description: Optional[str] = None
    file_url: Optional[str] = None
    content: Optional[str] = None
    confirmation_button_text: str
    created_by_user_id: int
    author: Optional[DocumentUserBrief] = None
    status: str
    approval_required: bool
    approval_started_at: Optional[datetime] = None
    approval_completed_at: Optional[datetime] = None
    rejected_at: Optional[datetime] = None
    version: int
    created_at: datetime
    updated_at: datetime
    approvers_count: int = 0
    approved_count: int = 0
    assignees_count: int = 0
    confirmed_count: int = 0
    # Статус согласования текущего пользователя (если он - подписант этого документа)
    my_approval_status: Optional[str] = None
    # Статус ознакомления текущего пользователя (если документ назначен ему)
    my_assignment_status: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def model_validate(cls, obj, **kwargs):
        item = super().model_validate(obj, **kwargs)
        category = getattr(obj, "category", None)
        if category is not None:
            item.category_title = getattr(category, "title", None)
        return item


class DocumentApproversSet(BaseModel):
    approver_ids: List[int] = Field(default_factory=list)


class DocumentApproveRequest(BaseModel):
    comment: Optional[str] = None


class DocumentRejectRequest(BaseModel):
    comment: str = Field(min_length=1)


class DocumentAssignRequest(BaseModel):
    user_ids: Optional[List[int]] = Field(default=None, description="Конкретные пользователи")
    section_ids: Optional[List[int]] = Field(default=None, description="Отделы/участки целиком")
    workshop_ids: Optional[List[int]] = Field(default=None, description="Цеха целиком")


class DocumentAssignment(BaseModel):
    id: int
    document_id: int
    document_title: Optional[str] = None
    category_title: Optional[str] = None
    document_description: Optional[str] = None
    confirmation_button_text: Optional[str] = None
    assigned_to_user_id: int
    assigned_to: Optional[DocumentUserBrief] = None
    assigned_by_user_id: int
    target_type: str
    target_id: Optional[int] = None
    status: str
    assigned_at: datetime
    confirmed_at: Optional[datetime] = None
    last_reminder_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def model_validate(cls, obj, **kwargs):
        item = super().model_validate(obj, **kwargs)
        document = getattr(obj, "document", None)
        if document is not None:
            item.document_title = getattr(document, "title", None)
            item.document_description = getattr(document, "description", None)
            item.confirmation_button_text = getattr(document, "confirmation_button_text", None)
            category = getattr(document, "category", None)
            if category is not None:
                item.category_title = getattr(category, "title", None)
        return item


class DocumentApprovalReport(BaseModel):
    document_id: int
    document_title: str
    status: str
    document_version: int
    total: int
    approved_count: int
    rejected_count: int
    pending_count: int
    approvals: List[DocumentApproval]


class DocumentReportItem(BaseModel):
    id: int
    user: DocumentUserBrief
    status: str
    assigned_at: datetime
    confirmed_at: Optional[datetime] = None
    last_reminder_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class DocumentReport(BaseModel):
    document_id: int
    document_title: str
    total: int
    confirmed_count: int
    pending_count: int
    items: List[DocumentReportItem]
