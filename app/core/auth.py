import bcrypt
from fastapi.security import OAuth2PasswordBearer
from datetime import datetime, timedelta, timezone
import jwt
from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from sqlalchemy.orm import selectinload

from app.models.users import User as UserModel, AdminPermission as AdminPermissionModel
from app.core.config import SECRET_KEY, ALGORITHM
from app.api.dependencies import get_async_db


# Создаём контекст для хеширования с использованием bcrypt


ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="users/token")

def hash_password(password: str) -> str:
    """
    Преобразует пароль в хеш с использованием bcrypt.
    """
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Проверяет, соответствует ли введённый пароль сохранённому хешу.
    """
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))


def create_access_token(data: dict):
    """
    Создаёт JWT с payload (sub, role, id, exp).
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({
        "exp": expire,  # время жизни токена
        "token_type": "access",
    })
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def create_refresh_token(data: dict):
    """
    Создаёт refresh-токен с длительным сроком действия и token_type="refresh".
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({
        'exp': expire,
        'token_type': 'refresh',
    })
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user_optional(
    token: str | None = Depends(OAuth2PasswordBearer(tokenUrl="users/token", auto_error=False)),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Необязательная версия получения текущего пользователя.
    Не выбрасывает 401, если токен отсутствует или невалиден.
    """
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            return None
        result = await db.scalars(
            select(UserModel).where(UserModel.email == email, UserModel.is_active == True))
        return result.first()
    except:
        return None


async def get_current_user(token: str = Depends(oauth2_scheme),
                           db: AsyncSession = Depends(get_async_db)):
    """
    Проверяет JWT и возвращает пользователя из базы.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError as e:
        raise credentials_exception
    result = await db.scalars(
        select(UserModel).where(UserModel.email == email, UserModel.is_active == True))
    user = result.first()
    if user is None:
        raise credentials_exception
    return user


async def verify_refresh_token(refresh_token: str, db: AsyncSession):
    """
    Проверяет refresh-токен и возвращает пользователя, если он валиден.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate refresh token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str | None = payload.get("sub")
        token_type: str | None = payload.get("token_type")

        if email is None or token_type != "refresh":
            raise credentials_exception

    except (jwt.ExpiredSignatureError, jwt.PyJWTError):
        raise credentials_exception

    result = await db.scalars(
        select(UserModel).where(
            UserModel.email == email,
            UserModel.is_active == True
        )
    )
    user = result.first()
    if user is None:
        raise credentials_exception
    return user



async def get_current_seller(current_user: UserModel = Depends(get_current_user)):
    """
    Проверяет, что пользователь имеет роль 'seller' или выше (admin, owner).
    """
    if current_user.role not in ["seller", "admin", "owner"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return current_user


async def get_current_admin(current_user: UserModel = Depends(get_current_user)):
    """
    Проверяет, что пользователь имеет роль 'admin' или 'owner'.
    """
    if current_user.role not in ["admin", "owner"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can perform this action")
    return current_user


async def get_current_owner(current_user: UserModel = Depends(get_current_user)):
    """
    Проверяет, что пользователь имеет роль 'owner'.
    """
    if current_user.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owner can perform this action")
    return current_user


async def get_current_buyer(current_user: UserModel = Depends(get_current_user)):
    """
    Проверяет, что пользователь имеет роль 'buyer' или выше.
    """
    # Обычно всем можно, но если нужно строго:
    return current_user


def check_admin_permission(model_name: str):
    """
    Зависимость для проверки прав админа на конкретную модель.
    Владелец имеет доступ ко всему.
    """
    async def _check_permission(
        current_user: UserModel = Depends(get_current_user),
        db: AsyncSession = Depends(get_async_db)
    ):
        if current_user.role == "owner":
            return True
        
        if current_user.role == "admin":
            # Проверяем разрешения в базе
            result = await db.execute(
                select(AdminPermissionModel).where(
                    AdminPermissionModel.admin_id == current_user.id,
                    AdminPermissionModel.model_name == model_name
                )
            )
            if result.scalar_one_or_none():
                return True
        
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail=f"You don't have permission to manage {model_name}"
        )
    return _check_permission