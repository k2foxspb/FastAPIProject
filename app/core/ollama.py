"""
Общий клиент локального ИИ (Ollama).

Мобильное приложение никогда не обращается к Ollama напрямую - только через
эндпоинты backend. Ошибки клиента не привязаны к HTTP: роутеры сами решают,
какой код вернуть (чат ИИ - 500, журнал - 502/504).

    text = await ollama.chat(messages)
    answer = await ollama.chat_json(messages, MyModel)   # JSON-режим + строгая pydantic-проверка
"""
import json
import re
from typing import TypeVar

import httpx
from loguru import logger
from pydantic import BaseModel, ValidationError

from app.core.config import OLLAMA_MODEL, OLLAMA_URL

DEFAULT_OPTIONS = {
    "temperature": 0.3,
    "top_p": 0.8,
    "repeat_penalty": 1.1,
    "num_ctx": 4096,
}

T = TypeVar("T", bound=BaseModel)


class OllamaError(Exception):
    """Базовая ошибка обращения к Ollama; message - текст для пользователя."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class OllamaUnavailable(OllamaError):
    """Сервис недоступен (нет соединения)."""


class OllamaTimeout(OllamaUnavailable):
    """Модель не ответила за отведённое время."""


class OllamaHTTPError(OllamaError):
    """Ollama ответила кодом ошибки."""


class OllamaBadResponse(OllamaError):
    """Ответ не удалось разобрать (не JSON, пустой, не прошёл проверку схемы)."""


async def chat(
    messages: list[dict],
    *,
    client: httpx.AsyncClient | None = None,
    timeout: float = 60.0,
    options: dict | None = None,
    json_mode: bool = False,
) -> str:
    """Один запрос /api/chat без стриминга; возвращает текст ответа ассистента."""
    body = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "options": {**DEFAULT_OPTIONS, **(options or {})},
    }
    if json_mode:
        body["format"] = "json"

    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=timeout)
    try:
        response = await client.post(f"{OLLAMA_URL}/api/chat", json=body)
        response.raise_for_status()
        data = response.json()
    except httpx.TimeoutException as e:
        logger.error(f"Ollama не ответила вовремя ({OLLAMA_URL}): {type(e).__name__}")
        raise OllamaTimeout("Сервис ИИ не ответил вовремя. Попробуйте позже.")
    except httpx.RequestError as e:
        logger.error(
            f"Ollama недоступна ({OLLAMA_URL}): {e}. "
            "Проверьте на сервере: 1) запущен ли сервис Ollama (systemctl status ollama); "
            "2) слушает ли он 0.0.0.0, а не только 127.0.0.1 (переменная OLLAMA_HOST=0.0.0.0 "
            "в systemd-юните ollama.service, затем systemctl restart ollama); "
            "3) актуален ли OLLAMA_URL в .env на сервере (для backend в Docker - "
            "http://host.docker.internal:11434, для backend на хосте - http://localhost:11434) "
            "и был ли пересоздан контейнер web после изменения .env "
            "(docker compose up -d --build web)."
        )
        raise OllamaUnavailable("Сервис ИИ временно недоступен. Попробуйте позже.")
    except httpx.HTTPStatusError as e:
        logger.error(f"Ollama вернула ошибку {e.response.status_code}: {e.response.text[:500]}")
        raise OllamaHTTPError("Сервис ИИ вернул ошибку. Попробуйте позже.")
    except ValueError as e:
        logger.error(f"Не удалось разобрать ответ Ollama как JSON: {e}")
        raise OllamaBadResponse("Сервис ИИ вернул некорректный ответ.")
    finally:
        if own_client:
            await client.aclose()

    message = data.get("message") if isinstance(data, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not content or not str(content).strip():
        # Текст ответа в лог не пишем целиком - в нём могут быть данные пользователя
        logger.error("Пустой ответ от Ollama")
        raise OllamaBadResponse("Сервис ИИ вернул пустой ответ. Попробуйте переформулировать запрос.")
    return str(content)


_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL | re.IGNORECASE)


def extract_json(text: str):
    """
    Достаёт JSON из ответа модели: снимает ```json-ограждение, при лишнем тексте
    вокруг берёт первый сбалансированный объект/массив. Бросает OllamaBadResponse.
    """
    raw = (text or "").strip()
    fenced = _FENCE_RE.match(raw)
    if fenced:
        raw = fenced.group(1).strip()
    try:
        return json.loads(raw)
    except ValueError:
        pass
    decoder = json.JSONDecoder()
    for index, char in enumerate(raw):
        if char in "{[":
            try:
                value, _ = decoder.raw_decode(raw[index:])
                return value
            except ValueError:
                continue
    raise OllamaBadResponse("ИИ вернул некорректный ответ")


def parse_json_model(text: str, model: type[T]) -> T:
    """Строгий разбор ответа модели в pydantic-схему."""
    value = extract_json(text)
    try:
        return model.model_validate(value)
    except ValidationError as e:
        logger.warning(f"Ответ Ollama не прошёл проверку схемы {model.__name__}: {e.error_count()} ошибок")
        raise OllamaBadResponse("ИИ вернул некорректный ответ")


async def chat_json(
    messages: list[dict],
    model: type[T],
    *,
    client: httpx.AsyncClient | None = None,
    timeout: float = 60.0,
    options: dict | None = None,
) -> T:
    """Запрос в JSON-режиме с проверкой ответа по схеме."""
    text = await chat(messages, client=client, timeout=timeout, options=options, json_mode=True)
    return parse_json_model(text, model)
