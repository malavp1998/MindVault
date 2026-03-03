from __future__ import annotations
"""Auth service — Password hashing, JWT, user management."""

import logging
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from models import User

logger = logging.getLogger(__name__)
settings = get_settings()

# ── PASSWORD UTILS ────────────────────────────────────

def hash_password(password: str) -> str:
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('utf-8'))
    except (ValueError, TypeError):
        return False

def validate_password_strength(password: str) -> tuple[bool, str]:
    if len(password) < 4:
        return False, "Password must be at least 4 characters"
    return True, ""

# ── JWT UTILS ─────────────────────────────────────────

def create_access_token(user_id: str, identifier: str) -> str:
    """Create a signed JWT access token."""
    payload = {
        "sub": str(user_id),
        "identifier": identifier, # Could be username or phone
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_access_token_expire_minutes),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

def decode_token(token: str) -> dict | None:
    """Decode and verify a JWT token. Returns payload or None on failure."""
    try:
        return jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError:
        return None

# ── USER UTILS ────────────────────────────────────────

async def get_user_by_username(db: AsyncSession, username: str) -> User | None:
    result = await db.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()

async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()

async def get_user_by_id(db: AsyncSession, user_id: str) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()

async def create_user(db: AsyncSession, username: str, email: str, password: str) -> User:
    hashed = hash_password(password)
    user = User(username=username, email=email, hashed_password=hashed)
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user

async def update_last_login(db: AsyncSession, user_id: str):
    await db.execute(
        update(User).where(User.id == user_id).values(last_login=datetime.now(timezone.utc))
    )
    await db.flush()

async def get_or_create_user_by_phone(db: AsyncSession, phone_number: str) -> User:
    """Find existing user by phone or create a new one. Used for OTP."""
    result = await db.execute(
        select(User).where(User.phone_number == phone_number)
    )
    user = result.scalar_one_or_none()

    if not user:
        user = User(phone_number=phone_number)
        db.add(user)
        await db.flush()
        await db.refresh(user)

    await update_last_login(db, str(user.id))
    return user

# ── OTP UTILS (disabled by default, only loads when AUTH_METHOD=otp) ──

def get_otp_service():
    if settings.auth_method != "otp":
        raise RuntimeError("OTP auth is disabled. Set AUTH_METHOD=otp to enable.")
    from services.otp import send_otp_to_phone, verify_otp_code
    return send_otp_to_phone, verify_otp_code
