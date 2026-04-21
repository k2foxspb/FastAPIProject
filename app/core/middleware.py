
import time
from loguru import logger
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.sessions import SessionMiddleware
from starlette.datastructures import MutableHeaders



class TimingMiddleware:
    """Middleware для измерения времени выполнения запросов."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
            
        start_time = time.time()
        
        # Флаг, чтобы не логировать дважды (на start и disconnect/finish)
        logged = False

        async def send_wrapper(message):
            nonlocal logged
            if message["type"] == "http.response.start" and not logged:
                duration = time.time() - start_time
                method = scope.get("method", "UNKNOWN")
                path = scope.get("path", "UNKNOWN")
                logger.debug(f"Request: {method} {path} | Duration: {duration:.4f}s")
                logged = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as e:
            if not logged:
                duration = time.time() - start_time
                method = scope.get("method", "UNKNOWN")
                path = scope.get("path", "UNKNOWN")
                logger.error(f"Request: {method} {path} | FAILED | Duration: {duration:.4f}s | Error: {e}")
                logged = True
            raise e


class SessionRenewalMiddleware:
    """
    Middleware для автоматического продления сессии при каждом запросе.
    Starlette SessionMiddleware отправляет куку только если сессия была изменена.
    Этот middleware помечает сессию как измененную, если она существует.
    """
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        # Мы не можем просто пометить сессию как измененную здесь, 
        # так как SessionMiddleware еще не отработал и не добавил 'session' в scope.
        # Поэтому нам нужно обернуть send, чтобы перехватить ответ,
        # НО SessionMiddleware сам оборачивает send.
        
        # Правильный подход: SessionRenewalMiddleware должен стоять ВНУТРИ SessionMiddleware
        # и просто делать request.session["_renew"] = time.time()
        
        if "session" in scope:
            # Если мы уже внутри SessionMiddleware
            scope["session"]["_last_activity"] = int(time.time())
            
        return await self.app(scope, receive, send)


def setup_middleware(app: FastAPI) -> None:
    """Настройка всех middleware для приложения."""

    # ProxyFix for HTTPS
    @app.middleware("http")
    async def proxy_fix(request, call_next):
        # Handle X-Forwarded-Proto
        proto = request.headers.get("x-forwarded-proto")
        if proto:
            request.scope["scheme"] = proto
        
        # Handle X-Forwarded-Host
        host = request.headers.get("x-forwarded-host")
        if host:
            request.scope["headers"] = [
                (k, v) if k != b"host" else (b"host", host.encode())
                for k, v in request.scope["headers"]
            ]
            
        return await call_next(request)

    # Timing middleware
    app.add_middleware(TimingMiddleware)

    # CORS configuration
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Trusted Host
    # app.add_middleware(
    #     TrustedHostMiddleware,
    #     allowed_hosts=config.ALLOWED_HOSTS
    # )

    # GZip compression
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    # Sessions
    # Важно: SessionRenewalMiddleware должен быть внутри SessionMiddleware, 
    # чтобы иметь доступ к scope["session"]. 
    # В FastAPI/Starlette порядок add_middleware обратный: последний добавленный выполняется первым.
    # Значит SessionMiddleware должен быть добавлен ПОСЛЕ SessionRenewalMiddleware.
    
    app.add_middleware(SessionRenewalMiddleware)
    app.add_middleware(
        SessionMiddleware,
        secret_key=config.os.getenv("SESSION_SECRET_KEY", "7UzGQS7woBazLUtVQJG39ywOP7J7lkPkB0UmDhMgBR8="),
        max_age=30 * 24 * 60 * 60,  # 30 дней
        same_site="lax",
        https_only=False,  # Можно установить в True, если используется HTTPS
    )
# мидлвар на основе функции
# @app.middleware("http")
# async def modify_request_response_middleware(request: Request, call_next):
#     start_time = time.time()
#     response = await call_next(request)
#     duration = time.time() - start_time
#     print(f"Request duration: {duration:.10f} seconds")
#     return response





from app.core import config
