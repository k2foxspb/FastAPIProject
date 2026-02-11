from loguru import logger
import sys


def setup_logging() -> None:
    """Настройка логирования приложения."""

    # Удаляем дефолтный handler
    logger.remove()

    # Консольный вывод
    logger.add(
        sys.stdout,
        level="INFO",
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan> - <level>{message}</level>"
    )

    # Файловое логирование
    logger.add(
        "info.log",
        level="INFO",
        rotation="10 MB",
        retention="10 days",
        compression="zip"
    )