import uuid
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from database import get_db
from middleware.auth import get_current_user, CurrentUser
from models import Note, PendingAgentAction, ChatSession, ChatMessage, Topic, User
from services.agentic_chat import agentic_chat_graph, generate_session_title
from services.pipeline import process_note
from services.clustering import cluster_notes
from services.llm import llm_complete
from langchain_core.messages import HumanMessage, AIMessage

router = APIRouter(prefix="/api/agent", tags=["agentic-chat"])


# ── Request / Response models ─────────────────────────────────

from typing import Optional, List, Dict

class ChatRequest(BaseModel):
    message: str
    conversation_history: List[Dict] = []   # [{role, content}, ...]
    session_id: Optional[str] = None

class ChatSessionUpdate(BaseModel):
    title: Optional[str] = None
    is_pinned: Optional[bool] = None



class ChatResponse(BaseModel):
    response: str
    type: str                               # "answer" | "pending_confirmation"
    pending_action: Optional[Dict] = None      # only set when type == "pending_confirmation"
    cited_notes: Optional[List[Dict]] = None
    session_id: Optional[str] = None

# ── POST /api/agent/chat ──────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
async def agentic_chat(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    session_id = None
    session = None
    if request.session_id:
        try:
            session_id = uuid.UUID(request.session_id)
            session = await db.get(ChatSession, session_id)
            if not session or session.user_id != user.id:
                raise HTTPException(404, "Session not found")
        except ValueError:
            pass
            
    if not session:
        session = ChatSession(user_id=user.id, title="New Chat")
        db.add(session)
        await db.flush()
        await db.refresh(session)
        session_id = session.id
        
    user_msg = ChatMessage(
        session_id=session_id,
        role="user",
        content=request.message,
    )
    db.add(user_msg)
    await db.flush()

    messages = []
    for msg in request.conversation_history:
        role = msg.get("role")
        content = msg.get("content", "")
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))
            
    messages.append(HumanMessage(content=request.message))

    try:
        import asyncio
        initial_state = {
            "messages":   messages,
            "user_id":    str(user.id),
            "intent":     None,
            "tool_result": None,
            "pending_action_id": None,
            "final_response":    None,
            "compressed_summary": None,
            "retry_count": 0,
            "max_retries": 2,
        }
        result = await asyncio.wait_for(
            agentic_chat_graph.ainvoke(initial_state, config={"configurable": {"db": db}}),
            timeout=30.0
        )
    except asyncio.TimeoutError:
        import logging
        logging.getLogger(__name__).error(
            f"Agentic graph timed out after 30s — user={user.id} query='{request.message}'"
        )
        return ChatResponse(
            response="This is taking too long — try rephrasing.",
            type="answer",
            session_id=str(session_id),
            cited_notes=[]
        )
    except Exception as e:
        import logging
        error_msg = str(e)
        logging.getLogger(__name__).error(f"Agentic Chat Error: {error_msg}")
        
        # Surface rate limits friendly to the user
        if "429" in error_msg or "rate limit" in error_msg.lower() or "quota" in error_msg.lower():
            user_msg = "You have reached your daily LLM request quota. Please wait for the limit to reset or upgrade."
        else:
            user_msg = "I'm sorry, an internal error occurred while processing your request."
            
        return ChatResponse(
            response=user_msg,
            type="answer",
            session_id=str(session_id)
        )
    # READ path — return answer directly
    if result["final_response"] != "__PENDING_CONFIRMATION__":
        cited_notes = []
        cited_note_ids = []
        tool_res = result.get("tool_result")
        
        if isinstance(tool_res, list):
            for item in tool_res:
                if isinstance(item, dict) and "id" in item and "title" in item:
                    cited_notes.append({"id": item["id"], "title": item["title"]})
                    try:
                        valid_uuid = uuid.UUID(item["id"])
                        cited_note_ids.append(str(valid_uuid))
                    except ValueError:
                        pass
        elif isinstance(tool_res, dict):
            if "id" in tool_res and "title" in tool_res:
                cited_notes.append({"id": tool_res["id"], "title": tool_res["title"]})
                try:
                    valid_uuid = uuid.UUID(tool_res["id"])
                    cited_note_ids.append(str(valid_uuid))
                except ValueError:
                    pass

        assistant_msg = ChatMessage(
            session_id=session_id,
            role="assistant",
            content=result["final_response"],
            cited_note_ids=cited_note_ids if cited_note_ids else None
        )
        db.add(assistant_msg)
        
        if session.title == "New Chat" and len(request.conversation_history) == 0:
            try:
                title = await generate_session_title(request.message)
                session.title = title
            except Exception:
                pass
        
        session.updated_at = datetime.now(timezone.utc)
        await db.commit()

        return ChatResponse(
            response=result["final_response"],
            type="answer",
            cited_notes=cited_notes,
            session_id=str(session_id)
        )

    # WRITE path — fetch pending action and return preview to frontend
    action_id = result["pending_action_id"]
    action_result = await db.execute(
        select(PendingAgentAction).where(PendingAgentAction.id == action_id)
    )
    action = action_result.scalar_one()

    assistant_msg = ChatMessage(
        session_id=session_id,
        role="assistant",
        content=action.preview_message
    )
    db.add(assistant_msg)
    
    if session.title == "New Chat" and len(request.conversation_history) == 0:
        try:
            title = await generate_session_title(request.message)
            session.title = title
        except Exception:
            pass

    session.updated_at = datetime.now(timezone.utc)
    await db.commit()

    return ChatResponse(
        response=action.preview_message,
        type="pending_confirmation",
        pending_action={
            "token":   str(action.id),
            "type":    action.action_type,
            "message": action.preview_message,
            "diff":    action.payload.get("diff"),
        },
        session_id=str(session_id)
    )


# ── POST /api/agent/confirm/{token} ──────────────────────────

@router.post("/confirm/{token}")
async def confirm_action(
    token: str,
    approved: bool,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    try:
        action_uuid = uuid.UUID(token)
    except ValueError:
        raise HTTPException(400, "Invalid action token format")

    result = await db.execute(
        select(PendingAgentAction).where(
            PendingAgentAction.id == action_uuid,
            PendingAgentAction.user_id == str(user.id)
        )
    )
    action = result.scalar_one_or_none()

    if not action:
        raise HTTPException(404, "Action not found or already executed")

    if action.expires_at < datetime.utcnow():
        await db.delete(action)
        await db.commit()
        raise HTTPException(410, "Action expired. Please try again.")

    if not approved:
        await db.delete(action)
        await db.commit()
        return {"status": "denied", "message": "No changes made to your vault."}

    # ── Execute the approved action ───────────────────────────
    payload = action.payload
    # Handle both flat and nested payload structures (for backwards compatibility with existing pending actions)
    action_data = payload.get("payload", payload) if isinstance(payload, dict) else payload
    
    affected_note_id = None   # track which note to re-pipeline

    if action.action_type == "create_note":
        new_note = Note(
            title=action_data.get("title", ""),
            content=action_data.get("content", ""),
            user_id=user.id,
        )
        db.add(new_note)
        await db.flush()                         # get the new note's ID before commit
        affected_note_id = str(new_note.id)
        message = f"Created note '{action_data.get('title', '')}' successfully."

    elif action.action_type == "update_note":
        note_id_str = action_data.get("note_id")
        if not note_id_str:
            raise HTTPException(400, "Missing note_id in confirmation payload")
            
        try:
            valid_uuid = uuid.UUID(note_id_str)
        except ValueError:
            raise HTTPException(400, f"Invalid note_id format: {note_id_str}. Please ask the AI to try again and enforce it uses a valid ID.")

        note_result = await db.execute(
            select(Note).where(Note.id == valid_uuid)
        )
        note = note_result.scalar_one_or_none()
        if not note:
            raise HTTPException(404, "Note not found")
        note.content = action_data.get("new_content", "")
        affected_note_id = str(note.id)
        message = f"Updated note '{action_data.get('note_title', '')}' successfully."

    elif action.action_type == "delete_note":
        note_id_str = action_data.get("note_id")
        if not note_id_str:
            raise HTTPException(400, "Missing note_id in confirmation payload")
            
        try:
            valid_uuid = uuid.UUID(note_id_str)
        except ValueError:
            raise HTTPException(400, f"Invalid note_id format: {note_id_str}. Please ask the AI to try again and enforce it uses a valid ID.")

        note_result = await db.execute(
            select(Note).where(Note.id == valid_uuid)
        )
        note = note_result.scalar_one_or_none()
        if note:
            await db.delete(note)
        # No note to re-embed after delete — only recluster needed
        affected_note_id = None
        message = f"Deleted note '{payload['note_title']}' successfully."

    else:
        raise HTTPException(400, f"Unknown action type: {action.action_type}")

    # ── Commit the write ──────────────────────────────────────
    await db.delete(action)   # remove pending record after execution
    await db.commit()

    # ── Re-trigger pipeline AFTER commit ─────────────────────
    #
    # create / update → re-embed the note, then recluster
    # delete          → only recluster (no note to embed)
    #
    # Both use asyncio.create_task so the API responds immediately
    # and pipeline runs in the background — same pattern as manual save.

    if action.action_type in ("create_note", "update_note") and affected_note_id:
        asyncio.create_task(
            _run_pipeline_background(
                user_id=str(user.id),
                note_id=affected_note_id,
                db=db
            )
        )

    elif action.action_type == "delete_note":
        asyncio.create_task(
            _run_recluster_background(
                user_id=str(user.id),
                db=db
            )
        )

    return {"status": "executed", "message": message}


# ── Background task helpers ───────────────────────────────────
# Mirrors exactly how the existing note save route triggers the pipeline.
# Using separate async functions so create_task has a clean coroutine.

async def _run_pipeline_background(user_id: str, note_id: str, db: AsyncSession):
    """
    Full pipeline for create/update:
    1. Re-embed the note → pgvector
    2. Recluster all user notes → update topics + graph coords
    3. Update retention score
    """
    try:
        await process_note(uuid.UUID(note_id))
    except Exception as e:
        # Never let background failure crash the confirmed write
        import logging
        logging.getLogger(__name__).error(
            f"Pipeline re-trigger failed after agent write: {e}"
        )


async def _run_recluster_background(user_id: str, db: AsyncSession):
    """
    Recluster only — used after delete where there is no note to re-embed.
    Recalculates topic assignments and graph coords for remaining notes.
    """
    try:
        await cluster_notes(user_id=uuid.UUID(user_id))
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(
            f"Recluster failed after agent delete: {e}"
        )


# ── UTILITY ROUTES FROM LEGACY CHAT ───────────────────────────

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

    import json
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
        import logging
        logging.getLogger(__name__).error(f"[Suggestions] LLM failed, building from topics: {e}")

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
        "is_pinned": session.is_pinned,
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
        .having(func.count(ChatMessage.id) > 0)
        .order_by(ChatSession.updated_at.desc())
    )
    rows = result.all()

    return [
        {
            "id": str(session.id),
            "title": session.title,
            "is_pinned": session.is_pinned,
            "created_at": session.created_at.isoformat(),
            "updated_at": session.updated_at.isoformat(),
            "message_count": count,
        }
        for session, count in rows
    ]


@router.patch("/sessions/{session_id}")
async def update_session(
    session_id: uuid.UUID,
    update_data: ChatSessionUpdate,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Update chat session metadata (title, pinned status)."""
    session = await db.get(ChatSession, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(404, "Session not found")
        
    if update_data.title is not None:
        session.title = update_data.title
    if update_data.is_pinned is not None:
        session.is_pinned = update_data.is_pinned
        
    session.updated_at = datetime.now(timezone.utc)
    await db.commit()
    
    return {
        "id": str(session.id),
        "title": session.title,
        "is_pinned": session.is_pinned,
        "updated_at": session.updated_at.isoformat(),
    }


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
        # Convert string UUIDs back to UUID objects for Postgres IN query
        valid_ids = []
        for nid in all_cited_ids:
            try:
                valid_ids.append(uuid.UUID(str(nid)))
            except ValueError:
                pass
                
        if valid_ids:
            notes_res = await db.execute(
                select(Note.id, Note.title).where(Note.id.in_(valid_ids))
            )
            for nid, title in notes_res.all():
                notes_map[str(nid)] = title

    out_messages = []
    for m in messages:
        cited_notes = []
        c_ids = getattr(m, "cited_note_ids", None)
        if c_ids:
            for nid in c_ids:
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


@router.delete("/sessions/{session_id}/messages", status_code=204)
async def clear_session_messages(
    session_id: uuid.UUID,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Clear all messages from a chat session without deleting the session itself."""
    session = await db.get(ChatSession, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(404, "Session not found")
    
    await db.execute(
        delete(ChatMessage).where(ChatMessage.session_id == session_id)
    )
    
    session.updated_at = datetime.now(timezone.utc)
    await db.commit()
