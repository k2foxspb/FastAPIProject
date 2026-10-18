from typing import List, Literal

from pydantic import BaseModel, Field


class AiChatMessage(BaseModel):
    """Одно сообщение в диалоге с ИИ (от пользователя или ассистента)."""

    role: Literal["user", "assistant", "system"]
    content: str = Field(min_length=1)


class AiChatRequest(BaseModel):
    """Тело запроса POST /api/ai/chat."""

    messages: List[AiChatMessage]


class AiChatResponseMessage(BaseModel):
    role: Literal["assistant"] = "assistant"
    content: str


class AiChatResponse(BaseModel):
    """Ответ backend мобильному приложению."""

    message: AiChatResponseMessage
