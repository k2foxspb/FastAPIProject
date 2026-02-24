import sqlite3
import os

db_path = "sql_app.db"
if not os.path.exists(db_path):
    print(f"Database {db_path} not found.")
else:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT id, email, fcm_token FROM users WHERE id = 1;")
    user = cursor.fetchone()
    if user:
        print(f"User 1: ID={user[0]}, Email={user[1]}, FCM_Token={user[2]}")
    else:
        print("User 1 not found.")
    conn.close()
