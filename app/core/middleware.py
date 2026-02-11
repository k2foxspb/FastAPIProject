
import time
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.sessions import SessionMiddleware



class TimingMiddleware:
    """Middleware для измерения времени выполнения запросов."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        start_time = time.time()
        await self.app(scope, receive, send)
        duration = time.time() - start_time
        print(f"Request duration: {duration:.10f} seconds")


def setup_middleware(app: FastAPI) -> None:
    """Настройка всех middleware для приложения."""

    # Timing middleware
    app.add_middleware(TimingMiddleware)

    # CORS
    origins = [
        "http://127.0.0.1:8000",
        "http://localhost:63342",
        "https://example.com",
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    # Trusted Host
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["127.0.0.1", "localhost:8000", "*"]
    )

    # GZip compression
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    # Sessions
    app.add_middleware(
        SessionMiddleware,
        secret_key="7UzGQS7woBazLUtVQJG39ywOP7J7lkPkB0UmDhMgBR8="  # Лучше перенести в .env
    )
# мидлвар на основе функции
# @app.middleware("http")
# async def modify_request_response_middleware(request: Request, call_next):
#     start_time = time.time()
#     response = await call_next(request)
#     duration = time.time() - start_time
#     print(f"Request duration: {duration:.10f} seconds")
#     return response




