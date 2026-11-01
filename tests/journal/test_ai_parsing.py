"""ИИ журнала: разбор ответов модели, ошибки 502/504, ограничение частоты (429)."""
import httpx
import pytest

from app.core import config, ollama
from app.schemas.journal.diet import AiNutritionAnswer

pytestmark = pytest.mark.asyncio

# Настоящий класс клиента (до подмены): повторный mock_ollama в одном тесте не должен оборачивать предыдущий
REAL_ASYNC_CLIENT = httpx.AsyncClient

GOOD = '{"items": [{"name": "Борщ", "grams": 300, "kcal": 150, "protein": 7, "fat": 6, "carbs": 18},' \
       ' {"name": "Хлеб", "grams": 60, "kcal": 150, "protein": 5, "fat": 1, "carbs": 30}]}'


# ---------------------------------------------------------------- разбор без сети

def test_extract_json_variants():
    assert ollama.extract_json(GOOD)["items"][0]["name"] == "Борщ"
    assert ollama.extract_json(f"```json\n{GOOD}\n```")["items"][1]["grams"] == 60
    assert ollama.extract_json(f"Вот оценка:\n{GOOD}\nПриятного аппетита!")["items"][0]["kcal"] == 150


@pytest.mark.parametrize("text", [
    "",
    "Не знаю",
    '{"items": [{"name": "Борщ", "grams": 300',          # обрезанный JSON
])
def test_extract_json_garbage(text):
    with pytest.raises(ollama.OllamaBadResponse):
        ollama.extract_json(text)


@pytest.mark.parametrize("text", [
    '{"items": []}',                                                                       # пусто
    '{"items": [{"name": "Борщ", "grams": -1, "kcal": 1, "protein": 1, "fat": 1, "carbs": 1}]}',  # отрицательный вес
    '{"items": [{"name": "Борщ", "grams": 300, "kcal": "много", "protein": 1, "fat": 1, "carbs": 1}]}',
    '{"food": "борщ"}',                                                                    # не та схема
    '[1, 2, 3]',
])
def test_parse_json_model_rejects_invalid(text):
    with pytest.raises(ollama.OllamaBadResponse):
        ollama.parse_json_model(text, AiNutritionAnswer)


# ---------------------------------------------------------------- эндпоинт

def mock_ollama(monkeypatch, handler):
    """Подменяет HTTP-транспорт клиента Ollama: handler(request) -> httpx.Response или исключение."""
    seen = []

    def factory(*args, **kwargs):
        def transport_handler(request):
            seen.append(request)
            return handler(request)
        kwargs["transport"] = httpx.MockTransport(transport_handler)
        return REAL_ASYNC_CLIENT(*args, **kwargs)

    monkeypatch.setattr(ollama.httpx, "AsyncClient", factory)
    return seen


def chat_response(content: str) -> httpx.Response:
    return httpx.Response(200, json={"message": {"role": "assistant", "content": content}})


async def test_estimate_nutrition_ok(client, monkeypatch):
    seen = mock_ollama(monkeypatch, lambda request: chat_response(GOOD))
    response = await client.post("/api/journal/ai/estimate-nutrition", json={"text": "съел борщ и 2 куска хлеба"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert [i["name"] for i in body["items"]] == ["Борщ", "Хлеб"]
    assert body["items"][0]["kcal_100"] == 50 and body["items"][1]["carbs_100"] == 50
    assert body["total"] == {"kcal": 300, "protein": 12, "fat": 7, "carbs": 48, "grams": 360}
    assert body["disclaimer"]
    # Запрос ушёл в JSON-режиме
    import json
    assert json.loads(seen[0].content)["format"] == "json"


@pytest.mark.parametrize("content", [
    "Извините, не могу помочь",
    '{"items": [{"name": "Борщ"',
    # 2000 ккал на 100 г - неправдоподобно
    '{"items": [{"name": "Масло", "grams": 10, "kcal": 200, "protein": 0, "fat": 9, "carbs": 0}]}',
])
async def test_estimate_nutrition_bad_answer_502(client, monkeypatch, content):
    mock_ollama(monkeypatch, lambda request: chat_response(content))
    response = await client.post("/api/journal/ai/estimate-nutrition", json={"text": "масло"})
    assert response.status_code == 502
    assert response.json()["detail"]


async def test_estimate_nutrition_timeout_504(client, monkeypatch):
    def handler(request):
        raise httpx.ReadTimeout("timeout", request=request)
    mock_ollama(monkeypatch, handler)
    response = await client.post("/api/journal/ai/estimate-nutrition", json={"text": "борщ"})
    assert response.status_code == 504


async def test_estimate_nutrition_unavailable_502(client, monkeypatch):
    def handler(request):
        raise httpx.ConnectError("refused", request=request)
    mock_ollama(monkeypatch, handler)
    response = await client.post("/api/journal/ai/estimate-nutrition", json={"text": "борщ"})
    assert response.status_code == 502


async def test_estimate_nutrition_validation(client):
    response = await client.post("/api/journal/ai/estimate-nutrition", json={"text": " "})
    assert response.status_code == 422
    response = await client.post("/api/journal/ai/estimate-nutrition", json={"text": "x" * 1001})
    assert response.status_code == 422


async def test_estimate_nutrition_rate_limit_429(client, monkeypatch):
    mock_ollama(monkeypatch, lambda request: chat_response(GOOD))
    for _ in range(config.JOURNAL_AI_RATE_LIMIT_PER_HOUR):
        assert (await client.post("/api/journal/ai/estimate-nutrition", json={"text": "борщ"})).status_code == 200
    response = await client.post("/api/journal/ai/estimate-nutrition", json={"text": "борщ"})
    assert response.status_code == 429


async def test_ai_chat_errors_unchanged(client, monkeypatch):
    """Чат ИИ после выноса клиента Ollama отвечает как раньше: 500 с прежним текстом."""
    def handler(request):
        raise httpx.ConnectError("refused", request=request)
    mock_ollama(monkeypatch, handler)
    response = await client.post("/api/ai/chat", json={"messages": [{"role": "user", "content": "Привет"}]})
    assert response.status_code == 500
    assert response.json()["detail"] == "Сервис ИИ временно недоступен. Попробуйте позже."

    mock_ollama(monkeypatch, lambda request: chat_response("Привет! Чем помочь?"))
    response = await client.post("/api/ai/chat", json={"messages": [{"role": "user", "content": "Привет"}]})
    assert response.status_code == 200
    assert response.json()["message"]["content"] == "Привет! Чем помочь?"
