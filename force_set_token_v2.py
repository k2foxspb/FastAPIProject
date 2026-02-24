import sqlite3
import sys
import os

def force_set_token_sync(user_id, token):
    # Пытаемся найти файл базы данных
    db_paths = ["sql_app.db", "ecommerce.db", "test_reproduce.db"]
    db_file = None
    for path in db_paths:
        if os.path.exists(path):
            db_file = path
            break
            
    if not db_file:
        print("❌ Database file not found in current directory.")
        return False
        
    print(f"Using database: {db_file}")
    
    try:
        conn = sqlite3.connect(db_file)
        cursor = conn.cursor()
        
        # Проверяем существование таблицы
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users';")
        if not cursor.fetchone():
            print("❌ Table 'users' not found in this database.")
            return False
            
        # Ищем пользователя
        cursor.execute("SELECT id, email, fcm_token FROM users WHERE id = ?", (user_id,))
        user = cursor.fetchone()
        
        if not user:
            print(f"❌ User with ID {user_id} not found.")
            return False
            
        print(f"Found user: {user[1]} (Current token: {str(user[2])[:15]}...)")
        
        # Обновляем токен
        cursor.execute("UPDATE users SET fcm_token = ? WHERE id = ?", (token, user_id))
        conn.commit()
        
        print(f"✅ Successfully updated FCM token for user {user_id}")
        conn.close()
        return True
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python force_set_token_v2.py <USER_ID> <FCM_TOKEN>")
        sys.exit(1)
        
    uid = int(sys.argv[1])
    tok = sys.argv[2]
    
    force_set_token_sync(uid, tok)
