from __future__ import annotations
"""Chat service — RAG-grounded multi-turn conversation with the vault."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from services.embedding import get_embedding
from services.llm import llm_complete, llm_complete_with_history
from services.language import detect_language, is_indic
from services.semantic_cache import get_cached_response, set_cached_response

MAX_HISTORY_MESSAGES = 10   # last 10 messages sent to LLM
MAX_CONTEXT_NOTES = 5       # top 5 notes retrieved per message


async def generate_session_title(first_message: str) -> str:
    """Generate a short 4-6 word title for a chat session."""
    prompt = (
        "Generate a short 4-6 word title for a chat session "
        "that starts with this message. "
        "Return ONLY the title, nothing else.\n\n"
        f"Message: {first_message}"
    )
    title = await llm_complete(prompt, "en")
    # Clean up any quotes the LLM might add
    return title.strip().strip('"').strip("'")[:255]


async def chat_with_vault(
    query: str,
    user_id: str,
    conversation_history: list,
    db: AsyncSession,
) -> dict:
    """Generate a RAG-grounded response using the user's vault notes."""
    # Cache only first message in session (no prior context)
    is_first_message = len(conversation_history) == 0
    if is_first_message:
        cached = await get_cached_response(query, cache_key="chat", user_id=user_id)
        if cached:
            return {
                "answer": cached,
                "cited_notes": [],
                "cited_note_ids": [],
                "from_cache": True,
            }

    lang = detect_language(query)

    # Step 1 — embed query and retrieve relevant notes via pgvector
    query_embedding = await get_embedding(query)

    result = await db.execute(
        text("""
            SELECT id, title, content, source_url, summary,
                   1 - (embedding <=> CAST(:emb AS vector)) as similarity
            FROM notes
            WHERE embedding IS NOT NULL
              AND user_id = CAST(:uid AS uuid)
            ORDER BY embedding <=> CAST(:emb AS vector)
            LIMIT :top_k
        """),
        {"emb": str(query_embedding), "uid": user_id, "top_k": MAX_CONTEXT_NOTES},
    )
    rows = result.all()

    # Step 2 — build context from retrieved notes
    notes_context = ""
    cited_note_ids = []
    cited_notes = []

    if rows:
        note_blocks = []
        for r in rows:
            note_id, title, content, source_url, summary, similarity = r
            cited_note_ids.append(str(note_id))
            cited_notes.append({
                "id": str(note_id),
                "title": title,
                "source_url": source_url,
                "similarity": round(float(similarity), 2),
            })
            display_content = summary or content[:600]
            note_blocks.append(
                f"Note Title: {title}\n"
                f"Source: {source_url or 'Manual note'}\n"
                f"Content: {display_content}"
            )
        notes_context = "\n\n---\n\n".join(note_blocks)

    # Step 3 — build system prompt
    if is_indic(lang):
        system_prompt = (
            "Aap ek helpful AI assistant ho jo user ke personal knowledge "
            "vault ke basis par jawab deta hai.\n\n"
            "Neeche user ke saved notes hain. Sirf inhi notes ke basis par "
            "jawab do. Agar notes mein answer nahi hai to clearly batao. "
            "Answer same language mein do jisme question hai. "
            "Har answer ke end mein mention karo ki kis note se information li.\n\n"
            f"USER KE NOTES:\n{notes_context if notes_context else 'Abhi koi notes nahi hain.'}"
        )
    else:
        system_prompt = (
            "You are a helpful AI assistant that answers questions based "
            "on the user's personal knowledge vault.\n\n"
            "Below are the user's saved notes relevant to this conversation. "
            "Answer ONLY based on these notes. If the notes don't contain "
            "enough information, say so clearly — do not make things up. "
            "Always mention which note(s) you used at the end of your answer.\n\n"
            f"USER'S RELEVANT NOTES:\n{notes_context if notes_context else 'No notes found yet.'}"
        )

    # Step 4 — build message history for multi-turn context
    trimmed_history = conversation_history[-MAX_HISTORY_MESSAGES:]

    messages = [
        {"role": "system", "content": system_prompt},
        *trimmed_history,
        {"role": "user", "content": query},
    ]

    # Step 5 — call LLM with full conversation context
    answer = await llm_complete_with_history(messages, lang)

    # Cache first-message responses for fast repeat queries
    if is_first_message:
        from config import get_settings
        _settings = get_settings()
        await set_cached_response(query, answer, cache_key="chat", user_id=user_id, ttl_hours=_settings.cache_ttl_chat_hours)

    return {
        "answer": answer,
        "cited_notes": cited_notes,
        "cited_note_ids": cited_note_ids,
    }
