import uuid
import asyncio
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from middleware.auth import get_current_user
from models import Note, PendingAgentAction
from services.agentic_chat import agentic_chat_graph
from services.pipeline import process_note
from services.clustering import cluster_notes
from langchain_core.messages import HumanMessage

router = APIRouter(prefix="/api/agent", tags=["agentic-chat"])


# ── Request / Response models ─────────────────────────────────

from typing import Optional, List, Dict

class ChatRequest(BaseModel):
    message: str
    conversation_history: List[Dict] = []   # [{role, content}, ...]


class ChatResponse(BaseModel):
    response: str
    type: str                               # "answer" | "pending_confirmation"
    pending_action: Optional[Dict] = None      # only set when type == "pending_confirmation"
    cited_notes: Optional[List[Dict]] = None

# ── POST /api/agent/chat ──────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
async def agentic_chat(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    messages = [HumanMessage(content=request.message)]

    try:
        result = await agentic_chat_graph.ainvoke({
            "messages":   messages,
            "user_id":    str(user.id),
            "intent":     None,
            "tool_result": None,
            "pending_action_id": None,
            "final_response":    None,
        }, config={"configurable": {"db": db}})
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Agentic Chat Error: {e}")
        return ChatResponse(
            response="I'm sorry, an internal error occurred while processing your request.",
            type="answer"
        )
    # READ path — return answer directly
    if result["final_response"] != "__PENDING_CONFIRMATION__":
        cited_notes = []
        tool_res = result.get("tool_result")
        
        if isinstance(tool_res, list):
            for item in tool_res:
                if isinstance(item, dict) and "id" in item and "title" in item:
                    cited_notes.append({"id": item["id"], "title": item["title"]})
        elif isinstance(tool_res, dict):
            if "id" in tool_res and "title" in tool_res:
                cited_notes.append({"id": tool_res["id"], "title": tool_res["title"]})

        return ChatResponse(
            response=result["final_response"],
            type="answer",
            cited_notes=cited_notes
        )

    # WRITE path — fetch pending action and return preview to frontend
    action_id = result["pending_action_id"]
    action_result = await db.execute(
        select(PendingAgentAction).where(PendingAgentAction.id == action_id)
    )
    action = action_result.scalar_one()

    return ChatResponse(
        response=action.preview_message,
        type="pending_confirmation",
        pending_action={
            "token":   str(action.id),
            "type":    action.action_type,
            "message": action.preview_message,
            "diff":    action.payload.get("diff"),
        }
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
