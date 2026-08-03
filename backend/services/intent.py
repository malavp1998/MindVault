from __future__ import annotations
"""Shared messaging intent classifier — used by Slack and WhatsApp routes."""

import logging

from services.llm import llm_complete
from langsmith import traceable

logger = logging.getLogger(__name__)

SAVE_NOTE = "SAVE_NOTE"
SEARCH_OR_CHAT = "SEARCH_OR_CHAT"


@traceable(name="classify_message_intent", tags=["messaging", "intent"])
async def classify_message_intent(text: str) -> str:
    """Classify an inbound chat message as SAVE_NOTE or SEARCH_OR_CHAT.

    Falls back to SEARCH_OR_CHAT on any LLM failure — reading the vault is
    always safe, writing to it is not.
    """
    prompt = f"""<role>You are the MindVault intent router.</role>
<task>Classify the following user message into one of two intents: "SAVE_NOTE" or "SEARCH_OR_CHAT".</task>
<rules>
- "SAVE_NOTE": The user is giving you information, a thought, a link, or asking you to save/remember something. Example: "Save this", "My thoughts on X", "Meeting notes: ..."
- "SEARCH_OR_CHAT": The user is asking a question, asking you to find something, or having a general conversation. Example: "What do I know about X?", "Find my notes on Y"
- Return EXACTLY ONE string: "SAVE_NOTE" or "SEARCH_OR_CHAT". Nothing else.
</rules>
<message>{text}</message>
Intent:"""

    try:
        raw = await llm_complete(prompt, "en")
    except Exception as e:
        logger.warning(f"[Intent] classification failed, defaulting to search: {e}")
        return SEARCH_OR_CHAT

    return SAVE_NOTE if SAVE_NOTE in raw.strip().upper() else SEARCH_OR_CHAT
