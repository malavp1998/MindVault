from __future__ import annotations
"""WhatsApp/Twilio helpers — phone normalization, signature verification, outbound send."""

import logging
import re
from xml.sax.saxutils import escape

from fastapi import Request
from fastapi.responses import Response

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Twilio caps a single WhatsApp body at 1600 chars.
MAX_BODY_CHARS = 1500

_twilio_client = None


def _get_twilio_client():
    """Lazily construct the Twilio REST client (mirrors services/otp.py)."""
    global _twilio_client
    if _twilio_client is None:
        from twilio.rest import Client
        _twilio_client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
    return _twilio_client


def is_configured() -> bool:
    """True when real Twilio credentials are present."""
    sid = settings.twilio_account_sid
    return bool(sid) and sid not in ("", "your_twilio_sid")


# ── Phone numbers ───────────────────────────────────────────────

def normalize_phone(raw: str, default_country_code: str = "91") -> str | None:
    """Normalize a phone number to E.164 (+<country><number>).

    Accepts Twilio's "whatsapp:+919876543210" prefix, spaces, dashes and
    parentheses. A 10-digit bare number is assumed to be `default_country_code`.
    Returns None when the input cannot be a phone number.
    """
    if not raw:
        return None

    value = str(raw).strip()
    if value.lower().startswith("whatsapp:"):
        value = value.split(":", 1)[1]

    had_plus = value.startswith("+")
    digits = re.sub(r"\D", "", value)
    if not digits:
        return None

    if not had_plus:
        if len(digits) == 10:
            digits = default_country_code + digits
        elif digits.startswith("00"):
            digits = digits[2:]

    # E.164 allows at most 15 digits, and a country code is at least 1.
    if not 8 <= len(digits) <= 15:
        return None

    return f"+{digits}"


def to_whatsapp_address(e164: str) -> str:
    """Render an E.164 number as a Twilio WhatsApp address."""
    return e164 if e164.startswith("whatsapp:") else f"whatsapp:{e164}"


# ── Inbound: signature verification ─────────────────────────────

def _public_url(request: Request) -> str:
    """Rebuild the URL Twilio signed.

    Behind Render/Cloudflare the app sees http:// even though Twilio signed
    https://, so trust X-Forwarded-Proto and X-Forwarded-Host when present.
    """
    url = request.url
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
    host = request.headers.get("x-forwarded-host", "").split(",")[0].strip()
    if proto:
        url = url.replace(scheme=proto)
    if host:
        url = url.replace(netloc=host)
    return str(url)


def verify_twilio_signature(request: Request, form: dict) -> bool:
    """Validate the X-Twilio-Signature HMAC over the request URL and params."""
    if not is_configured():
        # No credentials configured — refuse rather than accept blindly.
        logger.error("[WhatsApp] Twilio not configured; rejecting inbound webhook")
        return False

    signature = request.headers.get("X-Twilio-Signature", "")
    if not signature:
        return False

    try:
        from twilio.request_validator import RequestValidator
        validator = RequestValidator(settings.twilio_auth_token)
        return validator.validate(_public_url(request), form, signature)
    except Exception as e:
        logger.error(f"[WhatsApp] Signature validation error: {e}")
        return False


# ── Outbound ────────────────────────────────────────────────────

def empty_twiml() -> Response:
    """Acknowledge a webhook without sending a reply body."""
    return Response(
        content="<?xml version='1.0' encoding='UTF-8'?><Response></Response>",
        media_type="application/xml",
    )


def twiml_reply(message: str) -> Response:
    """Reply inline via TwiML. Used for fast, synchronous responses."""
    body = escape((message or "")[:MAX_BODY_CHARS])
    return Response(
        content=f"<?xml version='1.0' encoding='UTF-8'?><Response><Message>{body}</Message></Response>",
        media_type="application/xml",
    )


async def send_whatsapp_message(to_e164: str, body: str) -> bool:
    """Push a WhatsApp message via the Twilio REST API.

    Used for answers that arrive after the webhook has already returned.
    Never raises — messaging failures must not crash background tasks.
    """
    if not is_configured():
        logger.warning(f"[WhatsApp] DEV MODE — would send to {to_e164}: {body[:120]}")
        return False

    from_addr = settings.twilio_phone_number
    if not from_addr:
        logger.error("[WhatsApp] TWILIO_PHONE_NUMBER is not set; cannot send")
        return False

    try:
        import asyncio
        client = _get_twilio_client()
        # The Twilio SDK is synchronous — keep it off the event loop.
        await asyncio.to_thread(
            client.messages.create,
            body=(body or "")[:MAX_BODY_CHARS],
            from_=to_whatsapp_address(from_addr),
            to=to_whatsapp_address(to_e164),
        )
        return True
    except Exception as e:
        logger.error(f"[WhatsApp] Send failed to {to_e164}: {e}")
        return False
