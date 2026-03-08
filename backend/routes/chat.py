from __future__ import annotations
"""Chat routes — multi-turn RAG conversation with the vault."""

import json
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import ChatSession, ChatMessage, Note, Topic, User
from middleware.auth import CurrentUser
from services.chat import chat_with_vault, generate_session_title
from services.llm import llm_complete
from langsmith.run_helpers import get_current_run_tree

router = APIRouter(prefix="/chat", tags=["chat"])


# ── SCHEMAS ───────────────────────────────────────────

class ChatMessageRequest(BaseModel):
    message: str
    session_id: str | None = None


# ── ROUTES ────────────────────────────────────────────

GENERIC_SUGGESTIONS = [
    "What have I saved recently?",
    "Summarize everything in my vault",
    "What topics have I been studying?",
    "Show me my most recent notes",
]


@router.get("/suggestions")
async def get_chat_suggestions(
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Generate dynamic chat suggestions based on the user's vault content."""
    # Fetch user's topics (top 6 by note count)
    topic_result = await db.execute(
        select(Topic)
        .where(Topic.user_id == current_user.id)
        .order_by(Topic.note_count.desc())
        .limit(6)
    )
    topics = topic_result.scalars().all()

    # Fetch recent processed notes (last 10)
    note_result = await db.execute(
        select(Note)
        .where(Note.user_id == current_user.id, Note.processed == True)  # noqa: E712
        .order_by(Note.created_at.desc())
        .limit(10)
    )
    recent_notes = note_result.scalars().all()

    # Vault is empty — return generic fallback
    if not topics and not recent_notes:
        return {"suggestions": GENERIC_SUGGESTIONS, "source": "fallback"}

    # Build context from real vault content
    topics_list = ", ".join([t.name for t in topics]) if topics else ""
    notes_titles = "\n".join(
        [f"- {n.title}" for n in recent_notes]
    ) if recent_notes else ""

    prompt = f"""A user has a personal knowledge vault with these contents:

Topics in vault: {topics_list}

Recent notes saved:
{notes_titles}

Generate exactly 4 short, specific questions the user might want to ask about THEIR OWN notes and vault content.

Rules:
- Questions must be directly relevant to the topics and notes listed above
- Keep each question under 8 words
- Make them feel personal — use "my notes", "I saved", "I learned" etc
- Vary the question types: one summary, one specific topic, one comparison, one recent
- Return ONLY a JSON array of 4 strings, nothing else
- No markdown, no backticks, just raw JSON array

Example format:
["question 1", "question 2", "question 3", "question 4"]"""

    try:
        raw = await llm_complete(prompt, "en")
        clean = raw.strip().replace("```json", "").replace("```", "").strip()
        suggestions = json.loads(clean)

        if not isinstance(suggestions, list) or len(suggestions) < 2:
            raise ValueError("Invalid suggestions format")

        suggestions = [str(s) for s in suggestions[:4]]
        return {"suggestions": suggestions, "source": "generated"}

    except Exception as e:
        # LLM or parse failed — build simple suggestions from topic names
        print(f"[Suggestions] LLM failed, building from topics: {e}")

        fallback_from_topics = [
            f"Summarize my {t.name} notes" for t in topics[:4]
        ]
        combined = fallback_from_topics + GENERIC_SUGGESTIONS
        return {"suggestions": combined[:4], "source": "topics_fallback"}


@router.post("/sessions")
async def create_session(
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Create a new chat session."""
    session = ChatSession(user_id=current_user.id, title="New Chat")
    db.add(session)
    await db.flush()
    await db.refresh(session)
    return {
        "id": str(session.id),
        "title": session.title,
        "created_at": session.created_at.isoformat(),
        "updated_at": session.updated_at.isoformat(),
        "message_count": 0,
    }


@router.get("/sessions")
async def list_sessions(
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """List all chat sessions for the current user."""
    result = await db.execute(
        select(
            ChatSession,
            func.count(ChatMessage.id).label("message_count"),
        )
        .outerjoin(ChatMessage, ChatMessage.session_id == ChatSession.id)
        .where(ChatSession.user_id == current_user.id)
        .group_by(ChatSession.id)
        .order_by(ChatSession.updated_at.desc())
    )
    rows = result.all()

    return [
        {
            "id": str(session.id),
            "title": session.title,
            "created_at": session.created_at.isoformat(),
            "updated_at": session.updated_at.isoformat(),
            "message_count": count,
        }
        for session, count in rows
    ]


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: uuid.UUID,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Get all messages in a chat session."""
    # Verify ownership
    session = await db.get(ChatSession, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(404, "Session not found")

    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )
    messages = result.scalars().all()

    # Collect all unique cited note ids from history
    all_cited_ids = set()
    for m in messages:
        if m.cited_note_ids:
            all_cited_ids.update(m.cited_note_ids)

    notes_map = {}
    if all_cited_ids:
        # Fetch titles for cited notes
        notes_res = await db.execute(
            select(Note.id, Note.title).where(Note.id.in_(all_cited_ids))
        )
        for nid, title in notes_res.all():
            notes_map[str(nid)] = title

    out_messages = []
    for m in messages:
        cited_notes = []
        if m.cited_note_ids:
            for nid in m.cited_note_ids:
                if str(nid) in notes_map:
                    cited_notes.append({
                        "id": str(nid),
                        "title": notes_map[str(nid)],
                    })
        
        out_messages.append({
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "cited_notes": cited_notes,
            "created_at": m.created_at.isoformat(),
        })

    return out_messages


@router.post("/message")
async def send_message(
    req: ChatMessageRequest,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Send a message and get a RAG-grounded response."""

    run = get_current_run_tree()
    if run:
        run.metadata["user_id"] = str(current_user.id)
        run.metadata["session_id"] = req.session_id

    # Create or get session
    session_id = None
    session = None

    if req.session_id:
        session_id = uuid.UUID(req.session_id)
        session = await db.get(ChatSession, session_id)
        if not session or session.user_id != current_user.id:
            raise HTTPException(404, "Session not found")
    else:
        session = ChatSession(user_id=current_user.id, title="New Chat")
        db.add(session)
        await db.flush()
        await db.refresh(session)
        session_id = session.id

    # Fetch conversation history
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )
    history_msgs = result.scalars().all()
    conversation_history = [
        {"role": m.role, "content": m.content}
        for m in history_msgs
    ]

    # Save user message
    user_msg = ChatMessage(
        session_id=session_id,
        role="user",
        content=req.message,
    )
    db.add(user_msg)
    await db.flush()

    # Get AI response grounded in vault
    chat_result = await chat_with_vault(
        query=req.message,
        user_id=str(current_user.id),
        conversation_history=conversation_history,
        db=db,
    )

    # Save assistant response
    assistant_msg = ChatMessage(
        session_id=session_id,
        role="assistant",
        content=chat_result["answer"],
        cited_note_ids=chat_result["cited_note_ids"],
    )
    db.add(assistant_msg)
    await db.flush()

    # Auto-generate title from first message
    if session.title == "New Chat" and len(conversation_history) == 0:
        try:
            title = await generate_session_title(req.message)
            session.title = title
        except Exception:
            pass  # keep "New Chat" if title generation fails

    session.updated_at = datetime.now(timezone.utc)

    return {
        "session_id": str(session_id),
        "answer": chat_result["answer"],
        "cited_notes": chat_result["cited_notes"],
    }


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: uuid.UUID,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Delete a chat session and all its messages."""
    session = await db.get(ChatSession, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(404, "Session not found")
    await db.delete(session)
