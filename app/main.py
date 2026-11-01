from fastapi import FastAPI, HTTPException, Request, status
from pydantic import ValidationError
from starlette.templating import Jinja2Templates
import os

from app.core.middleware import setup_middleware
from app.core.logging import setup_logging
from app.core.config import ENABLE_API_DOCS
from app.api.routers import api_router
from app.api.routers.health import router as health_router
from app.api.routers.seo import router as seo_router

from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from loguru import logger

templates = Jinja2Templates(directory="app/templates")

def create_application() -> FastAPI:
    """Фабрика для создания приложения FastAPI."""

    # Настройка логирования
    setup_logging()

    # Создание приложения
    app = FastAPI(
        title="FastAPI Backend",
        version="0.1.0",
        description="API сервиса",
        docs_url="/docs" if ENABLE_API_DOCS else None,
        redoc_url="/redoc" if ENABLE_API_DOCS else None,
        openapi_url="/openapi.json" if ENABLE_API_DOCS else None,
    )

    # Настройка middleware
    setup_middleware(app)

    # Обработчик ошибок валидации для отладки
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        body = await request.body()
        logger.error(f"Validation error for {request.method} {request.url}")
        logger.error(f"Body: {body.decode(errors='replace')}")
        logger.error(f"Errors: {exc.errors()}")
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": exc.errors(), "body": body.decode(errors='replace')},
        )

    # Подключение роутеров
    app.include_router(api_router, prefix="")
    app.include_router(health_router)
    app.include_router(seo_router)

    # Файлы (media) теперь отдаются через слой хранения app.utils.storage,
    # который умеет искать файл на любом из настроенных дисков
    # (STORAGE_ROOT/STORAGE_DISKS, см. app/core/config.py и .env.example),
    # вместо того чтобы полагаться на единственную примонтированную директорию.
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # /home/fast/app

    from fastapi.responses import StreamingResponse, Response
    from fastapi import Query
    from typing import Optional
    from urllib.parse import quote
    import mimetypes
    from app.core import config as app_config
    from app.utils import storage as storage_service
    from app.utils.storage_exceptions import FileNotFoundInStorageError, StorageError
    import posixpath

    # Личные файлы (вложения журнала) через /media не отдаются - только владельцу
    # через /api/journal/attachments/{uuid}/file.
    private_media_prefixes = ("journal/",)

    def is_private_media(relative_path: str) -> bool:
        # lower(): на Windows пути нечувствительны к регистру ("Journal/..." - та же папка)
        normalized = posixpath.normpath(relative_path.replace("\\", "/")).lstrip("/").lower()
        return normalized == "journal" or normalized.startswith(private_media_prefixes)

    @app.api_route("/media/{file_path:path}", methods=["GET", "HEAD"])
    async def serve_media(file_path: str, sig: Optional[str] = Query(None)):
        metadata = storage_service.resolve_url(file_path)
        if metadata is None and "_thumb" in file_path:
            # Фолбэк на оригинал, если миниатюра отсутствует
            metadata = storage_service.resolve_url(file_path.replace("_thumb", ""))
        if metadata is None or is_private_media(metadata.relative_path):
            raise HTTPException(status_code=404, detail="File not found")

        is_private = storage_service.is_private_relative_path(metadata.relative_path)
        if is_private and not storage_service.verify_media_signature(metadata.relative_path, sig):
            # 404 вместо 403: не подтверждаем существование приватного файла
            raise HTTPException(status_code=404, detail="File not found")

        mime_type = metadata.mime_type or mimetypes.guess_type(file_path)[0] or "application/octet-stream"
        headers = {"X-Content-Type-Options": "nosniff"}
        if is_private:
            headers["Cache-Control"] = "private, max-age=3600"

        try:
            if not storage_service.exists(metadata):
                raise FileNotFoundInStorageError(metadata.relative_path)
        except FileNotFoundInStorageError:
            raise HTTPException(status_code=404, detail="File not found")

        # Продакшен: отдача через nginx (internal location /protected_media/), который
        # читает файл с диска сам. Работает для disk0 (единственный примонтированный диск).
        if is_private and app_config.STORAGE_ACCEL_REDIRECT and metadata.disk_id == "disk0":
            headers["X-Accel-Redirect"] = f"{storage_service.PROTECTED_MEDIA_PREFIX}{quote(metadata.relative_path, safe='/()')}"
            return Response(status_code=200, media_type=mime_type, headers=headers)

        try:
            stream = storage_service.get_file_stream(metadata)
        except FileNotFoundInStorageError:
            raise HTTPException(status_code=404, detail="File not found")
        except StorageError as e:
            logger.warning(f"Storage error while serving {file_path}: {e}")
            raise HTTPException(status_code=503, detail="Storage temporarily unavailable")

        return StreamingResponse(stream, media_type=mime_type, headers=headers)

    # Статика сайта (общие CSS/JS страниц документации) - /static/css/site.css, /static/js/site.js
    static_dir = os.path.join(project_root, "app", "static")
    os.makedirs(static_dir, exist_ok=True)
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    # Добавляем отдачу файла верификации Mail.ru напрямую из корня


    @app.get("/login")
    async def get_login(request: Request):
        return templates.TemplateResponse("login.html", {"request": request})

    @app.get("/")
    async def get_index(request: Request):
        return templates.TemplateResponse("index.html", {"request": request})


    @app.get("/logo.png")
    async def get_logo():
        from fastapi.responses import FileResponse
        return FileResponse(os.path.join(project_root, "app", "templates", "logo.png"))



    @app.get("/privacy-policy")
    async def get_privacy_policy(request: Request):
        return templates.TemplateResponse("privacy_policy.html", {"request": request})

    @app.get("/terms")
    async def get_rules(request: Request):
        return templates.TemplateResponse("terms_of_use.html", {"request": request})

    @app.get("/user-guide")
    async def get_user_guide(request: Request):
        return templates.TemplateResponse("user_guide.html", {"request": request})

    @app.get("/tech-docs")
    async def get_tech_docs(request: Request):
        return templates.TemplateResponse("tech_docs.html", {"request": request})

    return app


# Создание экземпляра приложения
app = create_application()


# Опционально: создание второй версии API
def create_v2_application() -> FastAPI:
    """Версия 2 API (если нужна)."""
    app_v2 = FastAPI(
        title="FastAPI Backend",
        version="0.2.0",
        description="API сервиса v2",
    )
    # Настройки для v2...
    return app_v2

# app_v1 = create_v2_application()
# app.mount('/v2', app_v1)