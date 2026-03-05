from __future__ import annotations
"""Chat routes — multi-turn RAG conversation with the vault."""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import ChatSession, ChatMessage, User
from middleware.auth import CurrentUser
from services.chat import chat_with_vault, generate_session_title
from langsmith.run_helpers import get_current_run_tree

router = APIRouter(prefix="/chat", tags=["chat"])


# ── SCHEMAS ───────────────────────────────────────────

class ChatMessageRequest(BaseModel):
    message: str
    session_id: str | None = None


# ── ROUTES ────────────────────────────────────────────

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

    return [
        {
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "cited_note_ids": m.cited_note_ids or [],
            "created_at": m.created_at.isoformat(),
        }
        for m in messages
    ]


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
