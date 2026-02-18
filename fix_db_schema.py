
import asyncio
import os
from sqlalchemy import text
from app.database import async_engine

async def check_and_fix_db():
    print("Starting DB check...")
    try:
        async with async_engine.connect() as conn:
            # Проверяем наличие колонки deleted_by_id в таблице friendships
            # Для PostgreSQL используем запрос к information_schema
            result = await conn.execute(text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name='friendships' AND column_name='deleted_by_id';
            """))
            column_exists = result.scalar() is not None
            
            if not column_exists:
                print("Column 'deleted_by_id' is missing in 'friendships' table. Adding it...")
                await conn.execute(text("""
                    ALTER TABLE friendships 
                    ADD COLUMN deleted_by_id INTEGER REFERENCES users(id);
                """))
                await conn.commit()
                print("Column 'deleted_by_id' added successfully.")
            else:
                print("Column 'deleted_by_id' already exists.")
                
            # Проверяем другие таблицы если нужно
            
    except Exception as e:
        print(f"Error during DB fix: {e}")

if __name__ == "__main__":
    asyncio.run(check_and_fix_db())
