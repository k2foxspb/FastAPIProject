import asyncio
import sys
import os
from sqlalchemy import update, select

# Add project root to sys.path
sys.path.append(os.getcwd())

from app.database import async_session_maker
from app.models.users import User

async def force_set_token(user_id, token):
    async with async_session_maker() as db:
        # Check if user exists
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        
        if not user:
            print(f"❌ User with ID {user_id} not found in the database.")
            return False
            
        print(f"User found: {user.email}")
        print(f"Current token: {user.fcm_token[:15] if user.fcm_token else 'None'}...")
        
        # Update token
        await db.execute(
            update(User)
            .where(User.id == user_id)
            .values(fcm_token=token)
        )
        await db.commit()
        print(f"✅ Successfully updated FCM token for user {user_id}")
        return True

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python force_set_token.py <USER_ID> <FCM_TOKEN>")
        sys.exit(1)
        
    uid = int(sys.argv[1])
    tok = sys.argv[2]
    
    asyncio.run(force_set_token(uid, tok))
