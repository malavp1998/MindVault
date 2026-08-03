from __future__ import annotations
"""Auth routes — Firebase handles login/register. Only /me and /logout remain."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from middleware.auth import CurrentUser
from models import User
from services.whatsapp import normalize_phone
from slowapi import Limiter
from slowapi.util import get_remote_address

router = APIRouter(prefix="/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)


class PhoneLink(BaseModel):
    phone_number: str


@router.get("/me")
async def get_me(current_user: User = CurrentUser):
    return {
        "id": str(current_user.id),
        "firebase_uid": current_user.firebase_uid,
        "username": current_user.username,
        "email": current_user.email,
        "phone_number": current_user.phone_number,
        "created_at": str(current_user.created_at),
        "last_login": str(current_user.last_login) if current_user.last_login else None,
    }


@router.post("/phone")
async def link_phone(
    body: PhoneLink,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Link a WhatsApp number to the signed-in account.

    Identity is already proven by the Firebase token, so no OTP is needed —
    the user can only ever claim a number for themselves.
    """
    phone = normalize_phone(body.phone_number)
    if not phone:
        raise HTTPException(
            400, "That doesn't look like a valid phone number. Include your country code."
        )

    existing = await db.execute(
        select(User).where(User.phone_number == phone, User.id != current_user.id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "That number is already linked to another account.")

    current_user.phone_number = phone
    await db.commit()

    return {"phone_number": phone, "message": "WhatsApp number linked."}


@router.delete("/phone")
async def unlink_phone(
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Remove the WhatsApp number from the signed-in account."""
    current_user.phone_number = None
    await db.commit()
    return {"phone_number": None, "message": "WhatsApp number removed."}

@router.post("/logout")
async def logout():
    return {"message": "Logged out successfully"}
