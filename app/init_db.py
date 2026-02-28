import asyncio
import sys
from sqlalchemy import select
from app.database import async_session_maker
from app.models.users import User
from app.core.auth import hash_password
from loguru import logger

async def init_owner():
    email = "k2foxspb@mail.ru"
    password = "qjhfq4ipc"
    
    try:
        async with async_session_maker() as session:
            # Проверяем, существует ли пользователь
            logger.info(f"Checking for owner account: {email}")
            try:
                result = await session.execute(select(User).where(User.email == email))
                user = result.scalar_one_or_none()
            except Exception as e:
                logger.error(f"Error querying database for user {email}: {e}")
                logger.error("This usually means the database schema is outdated. Ensure migrations are applied.")
                raise e
            
            if user:
                logger.info(f"User {email} already exists.")
                # Обновляем поля, если нужно
                user.role = "owner"
                user.is_active = True
                user.hashed_password = hash_password(password)
                logger.info(f"User {email} updated to owner and active.")
            else:
                # Создаем нового владельца
                new_user = User(
                    email=email,
                    hashed_password=hash_password(password),
                    role="owner",
                    is_active=True,
                    first_name="Owner",
                    last_name="System"
                )
                session.add(new_user)
                logger.info(f"User {email} created with owner role.")
                
            await session.commit()
            logger.info("Owner initialization successful.")
    except Exception as e:
        logger.critical(f"Failed to initialize owner: {e}")
        # Не выходим с ошибкой, чтобы не блокировать запуск основного приложения в web-контейнере,
        # если это критическая ошибка БД, она все равно проявится позже в самом приложении.
        # Но для отладки выведем трейсбэк.
        import traceback
        traceback.print_exc()

async def main():
    await init_owner()

if __name__ == "__main__":
    asyncio.run(main())
