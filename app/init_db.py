import asyncio
from sqlalchemy import select
from app.database import async_session_maker
from app.models.users import User
from app.core.auth import hash_password

async def init_owner():
    email = "k2foxspb@mail.ru"
    password = "qjhfq4ipc"
    
    async with async_session_maker() as session:
        # Проверяем, существует ли пользователь
        result = await session.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        
        if user:
            print(f"User {email} already exists.")
            # Обновляем поля, если нужно
            user.role = "owner"
            user.is_active = True
            user.hashed_password = hash_password(password)
            print(f"User {email} updated to owner and active.")
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
            print(f"User {email} created with owner role.")
            
        await session.commit()

if __name__ == "__main__":
    asyncio.run(init_owner())
