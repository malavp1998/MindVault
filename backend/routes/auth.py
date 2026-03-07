from __future__ import annotations
"""Auth routes — Firebase handles login/register. Only /me and /logout remain."""

from fastapi import APIRouter
from middleware.auth import CurrentUser
from models import User
from slowapi import Limiter
from slowapi.util import get_remote_address

router = APIRouter(prefix="/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)


@router.get("/me")
async def get_me(current_user: User = CurrentUser):
    return {
        "id": str(current_user.id),
        "firebase_uid": current_user.firebase_uid,
        "username": current_user.username,
        "email": current_user.email,
        "created_at": str(current_user.created_at),
        "last_login": str(current_user.last_login) if current_user.last_login else None,
    }

@router.post("/logout")
async def logout():
    return {"message": "Logged out successfully"}
