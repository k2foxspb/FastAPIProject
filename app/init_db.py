import asyncio
from sqlalchemy import select
from app.database import async_session_maker
from app.models.users import User
from loguru import logger

async def init_owner():
    """
    Назначает владельца системы автоматически: им становится пользователь с
    минимальным id в таблице users (обычно первый зарегистрированный
    пользователь - в Postgres/SQLite автоинкремент id начинается с 1).

    Никакой email/телефон/пароль больше не хардкодится - если в базе ещё нет
    ни одного пользователя, владелец просто не назначается и функция ничего
    не делает (владелец появится сам, как только зарегистрируется первый
    пользователь и init_owner будет вызван повторно, например при рестарте).
    """
    max_retries = 5
    retry_delay = 5

    for attempt in range(1, max_retries + 1):
        try:
            async with async_session_maker() as session:
                logger.info(f"Checking for owner account (Attempt {attempt}/{max_retries})")
                try:
                    result = await session.execute(select(User).order_by(User.id.asc()).limit(1))
                    first_user = result.scalar_one_or_none()
                except Exception as e:
                    logger.error(f"Error querying database for first user: {e}")
                    if attempt < max_retries:
                        logger.info(f"Retrying in {retry_delay} seconds...")
                        await asyncio.sleep(retry_delay)
                        continue
                    else:
                        logger.error("Max retries reached. This usually means the database is down or schema is outdated.")
                        raise e

                if first_user is None:
                    logger.info("В базе нет ни одного пользователя - владелец будет назначен автоматически после первой регистрации.")
                    return

                if first_user.role != "owner":
                    first_user.role = "owner"
                    first_user.is_active = True
                    logger.info(
                        f"Пользователь id={first_user.id} ({first_user.email or first_user.phone_number}) назначен владельцем."
                    )
                else:
                    logger.info(f"Владелец уже назначен: id={first_user.id}.")

                # На случай, если роль "owner" была выставлена вручную не тому
                # пользователю - гарантируем, что владелец только один.
                result_others = await session.execute(
                    select(User).where(User.role == "owner", User.id != first_user.id)
                )
                for other_owner in result_others.scalars().all():
                    other_owner.role = "admin"
                    logger.warning(
                        f"Пользователь id={other_owner.id} имел роль owner, но не является первым - понижен до admin."
                    )

                await session.commit()
                logger.info("Owner initialization successful.")
                return  # Успех, выходим из цикла
        except Exception as e:
            logger.critical(f"Failed to initialize owner on attempt {attempt}: {e}")
            if attempt < max_retries:
                logger.info(f"Retrying in {retry_delay} seconds...")
                await asyncio.sleep(retry_delay)
            else:
                import traceback
                traceback.print_exc()

async def main():
    await init_owner()

if __name__ == "__main__":
    asyncio.run(main())
