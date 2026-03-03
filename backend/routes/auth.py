from __future__ import annotations
"""Authentication routes — Login, Register, OTP send/verify, user info, logout."""

import re
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from slowapi import Limiter
from slowapi.util import get_remote_address

from database import get_db
from models import User
from config import get_settings
from services.auth import (
    verify_password, create_access_token,
    get_user_by_username, get_user_by_email, create_user,
    update_last_login, validate_password_strength,
    get_or_create_user_by_phone, get_otp_service
)
from middleware.auth import get_current_user, CurrentUser

router = APIRouter(prefix="/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)
settings = get_settings()

# ── SCHEMAS ───────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

class SendOTPRequest(BaseModel):
    phone_number: str

class VerifyOTPRequest(BaseModel):
    phone_number: str
    otp_code: str

# ── Helpers ──────────────────────────────────────────

def validate_phone(phone: str) -> bool:
    return bool(re.match(r"^\+[1-9]\d{9,14}$", phone))

# ── CREDENTIALS ROUTES (default) ─────────────────────

@router.post("/register")
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    if settings.auth_method != "credentials":
        raise HTTPException(400, "Credentials auth is disabled")

    # validate username
    if len(req.username) < 3:
        raise HTTPException(400, "Username must be at least 3 characters")
    if not req.username.isalnum():
        raise HTTPException(400, "Username must be alphanumeric only")

    # validate password strength
    valid, msg = validate_password_strength(req.password)
    if not valid:
        raise HTTPException(400, msg)

    # check username not taken
    existing_username = await get_user_by_username(db, req.username)
    if existing_username:
        raise HTTPException(400, "Username already taken")

    # check email not taken
    existing_email = await get_user_by_email(db, req.email)
    if existing_email:
        raise HTTPException(400, "Email already registered")

    # create user
    user = await create_user(db, req.username, req.email, req.password)

    # generate JWT immediately so user is logged in after register
    token = create_access_token(str(user.id), user.username)

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user.id),
            "username": user.username,
            "email": user.email
        }
    }

@router.post("/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    if settings.auth_method != "credentials":
        raise HTTPException(400, "Credentials auth is disabled")

    user = await get_user_by_username(db, req.username)

    # always run verify_password even if user not found
    # prevents timing attacks that reveal valid usernames
    # dummy_hash acts as a valid bcrypt signature to prevent timing attacks
    dummy_hash = "$2b$12$KIXeJp9bK5rXX.k/P/45n.oZl1ePqT1bY2Ym6nE7o7Q.JgEw77Gie"
    hashed = user.hashed_password if user and user.hashed_password else dummy_hash

    if not user or not verify_password(req.password, hashed):
        raise HTTPException(401, "Invalid username or password")

    if not user.is_active:
        raise HTTPException(401, "Account is disabled")

    await update_last_login(db, str(user.id))
    token = create_access_token(str(user.id), user.username)

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user.id),
            "username": user.username,
            "email": user.email
        }
    }

# ── OTP ROUTES (disabled by default) ─────────────────

@router.post("/send-otp")
async def send_otp_endpoint(req: SendOTPRequest, db: AsyncSession = Depends(get_db)):
    if settings.auth_method != "otp":
        raise HTTPException(
            400,
            "OTP auth is disabled. Set AUTH_METHOD=otp in .env to enable."
        )
    if not validate_phone(req.phone_number):
        raise HTTPException(400, "Invalid phone number format. Use +CountryCodeNumber")

    send_otp_to_phone, _ = get_otp_service()
    await send_otp_to_phone(db, req.phone_number)
    return { "message": "OTP sent successfully" }

@router.post("/verify-otp")
async def verify_otp_endpoint(req: VerifyOTPRequest, db: AsyncSession = Depends(get_db)):
    if settings.auth_method != "otp":
        raise HTTPException(
            400,
            "OTP auth is disabled. Set AUTH_METHOD=otp in .env to enable."
        )
    _, verify_otp_code = get_otp_service()
    is_valid = await verify_otp_code(db, req.phone_number, req.otp_code)
    if not is_valid:
        raise HTTPException(401, "Invalid or expired OTP")

    user = await get_or_create_user_by_phone(db, req.phone_number)
    token = create_access_token(str(user.id), user.phone_number)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user.id),
            "phone_number": user.phone_number,
            "created_at": str(user.created_at)
        }
    }

# ── SHARED ROUTES ─────────────────────────────────────

@router.get("/me")
async def get_me(current_user: User = CurrentUser):
    return {
        "id": str(current_user.id),
        "username": current_user.username,
        "email": current_user.email,
        "phone_number": current_user.phone_number,
        "created_at": str(current_user.created_at),
        "last_login": str(current_user.last_login) if current_user.last_login else None
    }

@router.post("/logout")
async def logout():
    return { "message": "Logged out successfully" }
