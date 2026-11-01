"""
Простое ограничение частоты запросов (фиксированное окно) на пользователя.

Счётчики хранятся в Redis (INCR + EXPIRE). Если Redis недоступен, используется
счётчик в памяти процесса (достаточно для разработки и одного воркера).

Использование в роутере:
    @router.post("/ai/estimate", dependencies=[Depends(rate_limit("journal_ai", 30, 3600))])
"""
import time
from threading import Lock

from fastapi import Depends, HTTPException, status
from loguru import logger

from app.core import config
from app.core.auth import get_current_user

_REDIS_RETRY_AFTER_SEC = 60

_redis_client = None
_redis_down_until = 0.0
_memory_counters: dict[str, tuple[int, float]] = {}
_memory_lock = Lock()


def _get_redis():
    global _redis_client
    if _redis_client is None:
        import redis.asyncio as aioredis
        _redis_client = aioredis.Redis(
            host=config.REDIS_HOST,
            port=int(config.REDIS_PORT),
            db=1,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
        )
    return _redis_client


def _memory_hit(key: str, window: int) -> int:
    now = time.monotonic()
    with _memory_lock:
        count, reset_at = _memory_counters.get(key, (0, now + window))
        if now >= reset_at:
            count, reset_at = 0, now + window
        count += 1
        _memory_counters[key] = (count, reset_at)
        # Не даём словарю бесконечно расти
        if len(_memory_counters) > 10000:
            for k in [k for k, (_, r) in _memory_counters.items() if r <= now]:
                _memory_counters.pop(k, None)
        return count


async def hit(key: str, window: int) -> int:
    """Увеличивает счётчик ключа в текущем окне и возвращает его значение."""
    global _redis_down_until
    if time.monotonic() >= _redis_down_until:
        try:
            client = _get_redis()
            count = await client.incr(key)
            if count == 1:
                await client.expire(key, window)
            return int(count)
        except Exception as e:
            _redis_down_until = time.monotonic() + _REDIS_RETRY_AFTER_SEC
            logger.warning(f"Rate limit: Redis недоступен, используем память процесса ({type(e).__name__})")
    return _memory_hit(key, window)


def reset_memory_counters() -> None:
    """Сбрасывает счётчики в памяти (для тестов)."""
    with _memory_lock:
        _memory_counters.clear()


def rate_limit(name: str, limit: int, window: int = 3600):
    """Зависимость FastAPI: не больше `limit` запросов пользователя за `window` секунд."""

    async def _dependency(current_user=Depends(get_current_user)):
        bucket = int(time.time() // window)
        count = await hit(f"rl:{name}:{current_user.id}:{bucket}", window)
        if count > limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Слишком много запросов, попробуйте позже",
            )
        return current_user

    return _dependency
