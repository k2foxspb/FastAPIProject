
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.core.config import DATABASE_URL

async def clear_alembic():
    db_url = DATABASE_URL
    if "db:5432" in db_url:
        import socket
        try:
            socket.gethostbyname("db")
        except socket.gaierror:
            db_url = db_url.replace("db:5432", "localhost:5432")
            
    print(f"Connecting to {db_url}...")
    try:
        engine = create_async_engine(db_url)
        async with engine.begin() as conn:
            await conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
            print("Table alembic_version dropped successfully")
        await engine.dispose()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(clear_alembic())
