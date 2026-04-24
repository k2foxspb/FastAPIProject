from loguru import logger
import sys


def setup_logging() -> None:
    """Настройка логирования приложения."""

    # Удаляем дефолтный handler
    logger.remove()

    # Консольный вывод
    logger.add(
        sys.stdout,
        level="DEBUG",
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