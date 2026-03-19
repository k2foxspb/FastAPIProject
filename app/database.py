
from sqlalchemy import create_engine, MetaData
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = 'sqlite:///ecommerce.db'
engine = create_engine(DATABASE_URL, echo=True)
SessionLocal = sessionmaker(bind=engine)

# Настройка конвенции именования для Alembic
naming_convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s"
}

# --------------- Асинхронное подключение к PostgreSQL -------------------------

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.core.config import DATABASE_URL

# Создаём Engine
async_engine = create_async_engine(DATABASE_URL, echo=True)

# Настраиваем фабрику сеансов
async_session_maker = async_sessionmaker(async_engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=naming_convention)