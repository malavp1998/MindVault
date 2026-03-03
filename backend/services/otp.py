# backend/services/otp.py
# DISABLED BY DEFAULT — only used when auth_method=otp in .env
import random
import string
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from models import OTPVerification

logger = logging.getLogger(__name__)
settings = get_settings()

_twilio_client = None

def _get_twilio_client():
    global _twilio_client
    if _twilio_client is None:
        from twilio.rest import Client
        _twilio_client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
    return _twilio_client

def generate_otp() -> str:
    """Generate a random 6-digit OTP code."""
    return "".join(random.choices(string.digits, k=6))

async def send_otp_to_phone(db: AsyncSession, phone_number: str) -> bool:
    """Invalidate old OTPs, create new one, and send SMS via Twilio."""
    otp = generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.otp_expire_minutes)

    await db.execute(
        update(OTPVerification)
        .where(OTPVerification.phone_number == phone_number, OTPVerification.is_used == False)
        .values(is_used=True)
    )

    otp_record = OTPVerification(
        phone_number=phone_number,
        otp_code=otp,
        expires_at=expires_at,
    )
    db.add(otp_record)
    await db.flush()

    if settings.twilio_account_sid and settings.twilio_account_sid not in ("", "your_twilio_sid"):
        try:
            client = _get_twilio_client()
            client.messages.create(
                body=f"Your MindVault OTP is: {otp}. Valid for {settings.otp_expire_minutes} minutes.",
                from_=settings.twilio_phone_number,
                to=phone_number,
            )
            logger.info(f"OTP sent to {phone_number} via Twilio")
        except Exception as e:
            logger.error(f"Twilio SMS failed: {e}")
            raise
    else:
        logger.warning(f"⚠️  DEV MODE — Twilio not configured. OTP for {phone_number}: {otp}")
    return True

async def verify_otp_code(db: AsyncSession, phone_number: str, otp_code: str) -> bool:
    """Validate an OTP code — must be unused and not expired."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(OTPVerification)
        .where(
            OTPVerification.phone_number == phone_number,
            OTPVerification.otp_code == otp_code,
            OTPVerification.is_used == False,
            OTPVerification.expires_at > now,
        )
        .order_by(OTPVerification.created_at.desc())
        .limit(1)
    )
    record = result.scalar_one_or_none()
    if not record:
        return False

    record.is_used = True
    await db.flush()
    return True
