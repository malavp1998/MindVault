from __future__ import annotations
"""WhatsApp inbound webhook — save notes and query the vault over Twilio."""

import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from database import async_session
from models import Note, User
from services.agent import rag_agent
from services.intent import SAVE_NOTE, classify_message_intent
from services.pipeline import process_note
from services.whatsapp import (
    empty_twiml,
    normalize_phone,
    send_whatsapp_message,
    twiml_reply,
    verify_twilio_signature,
)

logger = logging.getLogger(__name__)

router = APIRouter()

LINK_INSTRUCTIONS = (
    "👋 Welcome to MindVault!\n\n"
    "This number isn't linked to a vault yet. To connect it:\n\n"
    "1. Open https://mind-vault-piyush-malav-s-projects.vercel.app\n"
    "2. Go to Settings → General\n"
    "3. Add this number under WhatsApp and save\n\n"
    "Then message me again and I'll save notes and answer questions from your vault."
)


@router.post("/webhook")
async def whatsapp_webhook(request: Request):
    """Receive an inbound WhatsApp message from Twilio.

    Returns immediately with an acknowledgement; the answer is pushed
    separately via the REST API once the AI pipeline finishes, because
    embedding + LLM routinely exceeds Twilio's ~10s webhook window.
    """
    form = dict(await request.form())

    if not verify_twilio_signature(request, form):
        logger.warning("[WhatsApp] Rejected webhook with invalid signature")
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    text = str(form.get("Body", "")).strip()
    phone = normalize_phone(str(form.get("From", "")))

    if not phone:
        return empty_twiml()

    # Media is not supported yet — tell the sender rather than dropping it.
    try:
        num_media = int(form.get("NumMedia", "0") or 0)
    except ValueError:
        num_media = 0

    if num_media > 0 and not text:
        return twiml_reply(
            "📎 I can't process attachments yet — please send your note as text."
        )

    if not text:
        return empty_twiml()

    # ── Identity: look up only. Never auto-provision a phone number. ──
    async with async_session() as db:
        result = await db.execute(select(User).where(User.phone_number == phone))
        user = result.scalar_one_or_none()

        if not user:
            logger.info(f"[WhatsApp] Unlinked number messaged the bot: {phone}")
            return twiml_reply(LINK_INSTRUCTIONS)

        if not user.is_active:
            return twiml_reply("This account is disabled. Please contact support.")

        user_id = user.id

    # Hand off to the background so Twilio gets its response immediately.
    asyncio.create_task(_handle_message(text, phone, user_id))
    return empty_twiml()


async def _handle_message(text: str, phone: str, user_id) -> None:
    """Classify, then either save a note or answer from the vault."""
    try:
        intent = await classify_message_intent(text)

        if intent == SAVE_NOTE:
            await _save_note(text, phone, user_id)
        else:
            await _answer_question(text, phone, user_id)

    except Exception as e:
        logger.error(f"[WhatsApp] Handler failed for {phone}: {e}", exc_info=True)
        await send_whatsapp_message(
            phone, "❌ Something went wrong on my end. Please try again."
        )


async def _save_note(text: str, phone: str, user_id) -> None:
    """Persist the message as a note and trigger the AI pipeline."""
    title = text[:60].strip()
    if len(text) > 60:
        title += "…"

    async with async_session() as db:
        note = Note(
            title=title or "WhatsApp Note",
            content=text,
            source_url="whatsapp://message",
            tags=["whatsapp"],
            user_id=user_id,
            language="en",
        )
        db.add(note)
        await db.flush()
        note_id = note.id
        await db.commit()

    await send_whatsapp_message(
        phone,
        "✅ Saved to your vault. I'm summarizing, tagging and linking it now.",
    )

    # Best-effort enrichment — a pipeline failure must not lose the note.
    try:
        await process_note(note_id)
    except Exception as e:
        logger.error(f"[WhatsApp] Pipeline failed for note {note_id}: {e}")


async def _answer_question(text: str, phone: str, user_id) -> None:
    """Run the RAG agent and send back the answer with its sources."""
    initial_state = {
        "query": text,
        "retrieved_notes": [],
        "final_answer": "",
        "sources": [],
        "user_id": str(user_id),
    }

    try:
        final_state = await asyncio.wait_for(rag_agent.ainvoke(initial_state), timeout=60.0)
    except asyncio.TimeoutError:
        logger.error(f"[WhatsApp] RAG agent timed out for user {user_id}")
        await send_whatsapp_message(phone, "⏳ That took too long — try rephrasing?")
        return
    except Exception as e:
        logger.error(f"[WhatsApp] RAG agent failed: {e}", exc_info=True)
        await send_whatsapp_message(
            phone, "❌ I hit an error searching your vault. Please try again."
        )
        return

    answer = final_state.get("final_answer", "") or "I couldn't find anything relevant."
    sources = final_state.get("sources", [])

    if sources:
        titles = "\n".join(f"• {s.note.title}" for s in sources[:5])
        answer = f"{answer}\n\n*Sources:*\n{titles}"

    await send_whatsapp_message(phone, answer)
