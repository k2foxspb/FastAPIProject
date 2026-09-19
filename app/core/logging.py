from loguru import logger
import sys

from app.core.config import IS_PRODUCTION


def setup_logging() -> None:
    """Настройка логирования приложения."""

    # Удаляем дефолтный handler
    logger.remove()

    # Консольный вывод: в продакшене снижаем уровень до INFO, чтобы не засорять
    # логи отладочными сообщениями (в т.ч. потенциально чувствительными данными).
    console_level = "INFO" if IS_PRODUCTION else "DEBUG"
    logger.add(
        sys.stdout,
        level=console_level,
        format="<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{module}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>"
    )

    # Файловое логирование
    logger.add(
        "info.log",
        level="INFO",
        rotation="10 MB",
        retention="10 days",
        compression="zip"
    )