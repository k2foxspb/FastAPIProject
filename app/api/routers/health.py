from fastapi import APIRouter, Request
from starlette.responses import HTMLResponse
from starlette.templating import Jinja2Templates


router = APIRouter(prefix="", tags=["health"])


@router.get("/health")
async def health_check():
    """Проверка здоровья сервиса."""
    return {"status": "healthy"}


templates = Jinja2Templates(directory="app/templates")
@router.get("/", response_class=HTMLResponse)
def read_index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})
