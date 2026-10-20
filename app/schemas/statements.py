from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional


# --- Заявления ---

class StatementUserBrief(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class StatementCreate(BaseModel):
    """
    Создание заявления - текст сообщения и либо готовый шаблон (template_id),
    у которого администратор уже заранее настроил обязательных согласующих и
    уведомляемых, либо (если шаблон не выбран) ручной выбор галочками, кто из
    вышестоящих руководителей должен его согласовать (обязательно - все
    должны согласовать), а кого просто уведомить без требования согласования.
    """
    message: str = Field(min_length=1, description="Текст заявления")
    template_id: Optional[int] = Field(
        default=None, description="Шаблон заявления - если указан, согласующие/уведомляемые берутся из него"
    )
    approver_user_ids: list[int] = Field(
        default_factory=list,
        description="Руководители, обязанные согласовать заявление (используется, только если template_id не задан)",
    )
    notify_user_ids: list[int] = Field(
        default_factory=list,
        description="Руководители, которых нужно просто уведомить (используется, только если template_id не задан)",
    )
    is_draft: bool = Field(
        default=False,
        description="Создать как черновик (не отправлять сразу на согласование)",
    )

    @field_validator("message")
    @classmethod
    def message_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Текст заявления не может быть пустым")
        return v.strip()


class StatementUpdate(BaseModel):
    """Редактирование текста заявления при доработке или редактировании черновика."""
    message: str = Field(min_length=1, description="Обновлённый текст заявления")

    @field_validator("message")
    @classmethod
    def message_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Текст заявления не может быть пустым")
        return v.strip()


class StatementResubmit(BaseModel):
    """
    Повторная отправка заявления после доработки:
    mode='all' - согласовать заново со всеми (сброс согласований всех руководителей)
    mode='rejected_only' - отправить только руководителю, вернувшему на доработку (согласования остальных сохраняются)
    """
    message: Optional[str] = Field(default=None, description="Обновлённый текст заявления (если редактировался)")
    mode: str = Field(
        default="all",
        description="'all' - согласовать заново со всеми, 'rejected_only' - только вернувшему на доработку"
    )

    @field_validator("mode")
    @classmethod
    def mode_valid(cls, v: str) -> str:
        if v not in ("all", "rejected_only"):
            raise ValueError("mode должен быть 'all' или 'rejected_only'")
        return v

    @field_validator("message")
    @classmethod
    def message_not_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("Текст заявления не может быть пустым")
        return v.strip() if v is not None else v


# --- Шаблоны заявлений (настраиваются администратором) ---

class StatementTemplateRecipientIn(BaseModel):
    user_id: int
    role: str = Field(description="'approve' - обязательный согласующий, 'notify' - просто уведомляемый")

    @field_validator("role")
    @classmethod
    def role_valid(cls, v: str) -> str:
        if v not in ("approve", "notify"):
            raise ValueError("role должен быть 'approve' или 'notify'")
        return v


class StatementTemplateCreate(BaseModel):
    name: str = Field(min_length=1, description="Название шаблона, например 'Заявление на отпуск'")
    default_message: Optional[str] = Field(default=None, description="Текст заявления по умолчанию (можно изменить при подаче)")
    is_active: bool = True
    approver_user_ids: list[int] = Field(default_factory=list, description="Обязательные согласующие")
    notify_user_ids: list[int] = Field(default_factory=list, description="Просто уведомляемые")

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Название шаблона не может быть пустым")
        return v.strip()


class StatementTemplateUpdate(BaseModel):
    name: Optional[str] = None
    default_message: Optional[str] = None
    is_active: Optional[bool] = None
    approver_user_ids: Optional[list[int]] = None
    notify_user_ids: Optional[list[int]] = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("Название шаблона не может быть пустым")
        return v.strip() if v is not None else v


class StatementTemplateRecipientOut(BaseModel):
    user_id: int
    user: Optional[StatementUserBrief] = None
    role: str
    model_config = ConfigDict(from_attributes=True)


class StatementTemplate(BaseModel):
    id: int
    name: str
    default_message: Optional[str] = None
    is_active: bool = True
    created_at: datetime
    updated_at: datetime
    recipients: list[StatementTemplateRecipientOut] = Field(default_factory=list)
    model_config = ConfigDict(from_attributes=True)


class StatementReject(BaseModel):
    comment: str = Field(min_length=1, description="Комментарий обязателен при отклонении")


class StatementApprovalEntry(BaseModel):
    """Один согласующий/уведомляемый по заявлению - кто и как согласовал/отклонил."""
    approver_id: Optional[int] = None
    approver: Optional[StatementUserBrief] = None
    status: str
    comment: Optional[str] = None
    decided_at: Optional[datetime] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class StatementAuditLogEntry(BaseModel):
    """Запись в истории действий по заявлению."""
    id: int
    statement_id: int
    round: int
    actor_id: Optional[int] = None
    actor: Optional[StatementUserBrief] = None
    action: str
    resubmit_mode: Optional[str] = None
    comment: Optional[str] = None
    message_snapshot: Optional[str] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class Statement(BaseModel):
    id: int
    author_id: int
    author: Optional[StatementUserBrief] = None
    template_id: Optional[int] = None
    template_name: Optional[str] = None
    message: str
    status: str = "pending"
    round: int = 1
    reviewer_id: Optional[int] = None
    reviewer: Optional[StatementUserBrief] = None
    reviewer_comment: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    approvals: list[StatementApprovalEntry] = Field(default_factory=list)
    pending_approvers: list[StatementUserBrief] = Field(
        default_factory=list, description="Руководители, чьё согласование ещё требуется"
    )
    logs: list[StatementAuditLogEntry] = Field(
        default_factory=list, description="История действий по заявлению"
    )
    model_config = ConfigDict(from_attributes=True)
