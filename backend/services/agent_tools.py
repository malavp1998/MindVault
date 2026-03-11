import uuid
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from models import Note, Topic
from services.embedding import get_embedding

# ── READ TOOLS ────────────────────────────────────────────────

@tool
async def search_vault(query: str, user_id: str, config: RunnableConfig) -> list[dict]:
    """Search the vault using semantic similarity. Use for any read/recall/summarize intent."""
    db: AsyncSession = config["configurable"]["db"]
    query_embedding = await get_embedding(query)
    results = await db.execute(
        text("""
            SELECT n.id, n.title, n.content, t.name as topic_name,
                   1 - (n.embedding <=> CAST(:emb AS vector)) AS score
            FROM notes n
            LEFT JOIN topics t ON n.topic_id = t.id
            WHERE n.user_id = CAST(:uid AS UUID)
            ORDER BY n.embedding <=> CAST(:emb AS vector)
            LIMIT 5
        """),
        {"emb": str(query_embedding), "uid": user_id}
    )
    rows = results.fetchall()
    return [{"id": str(r.id), "title": r.title, "topic": r.topic_name, "content": r.content, "score": r.score} for r in rows]


@tool
async def read_note(note_id: str, config: RunnableConfig) -> dict:
    """Fetch a single note by ID. Use when you need full content of a specific note."""
    db: AsyncSession = config["configurable"]["db"]
    try:
        query_id = uuid.UUID(note_id)
    except ValueError:
        return {"error": "Invalid note ID format"}
        
    result = await db.execute(
        select(Note, Topic.name.label("topic_name"))
        .outerjoin(Topic, Note.topic_id == Topic.id)
        .where(Note.id == query_id)
    )
    row = result.first()
    if not row:
        return {"error": "Note not found"}
    note, topic_name = row
    return {"id": str(note.id), "title": note.title, "topic": topic_name, "content": note.content, "tags": note.tags}


# ── WRITE TOOLS (return preview — do NOT execute) ─────────────

@tool
async def propose_create_note(title: str, content: str) -> dict:
    """
    Propose creating a new note. Returns a preview payload — never writes directly.
    The caller must store this as a PendingAgentAction and ask user for confirmation.
    """
    return {
        "action_type": "create_note",
        "title": title,
        "content": content,
        "preview_message": f"I want to create a new note titled '{title}'. Allow?",
        "diff": {
            "before": None,
            "after": f"**{title}**\n\n{content}"
        }
    }


@tool
async def propose_update_note(note_id: str, note_title: str, original_content: str, new_content: str) -> dict:
    """
    Propose updating an existing note. Returns a diff preview — never writes directly.
    The caller must store this as a PendingAgentAction and ask user for confirmation.
    """
    try:
        uuid.UUID(note_id)
    except ValueError:
        return {"error": f"Invalid note ID '{note_id}'. You MUST use the `search_vault` tool to find the exact, valid UUID format note_id first for the note titled '{note_title}'."}

    return {
        "action_type": "update_note",
        "note_id": note_id,
        "note_title": note_title,
        "new_content": new_content,
        "preview_message": f"I want to update your note '{note_title}'. Allow?",
        "diff": {
            "before": original_content,
            "after": new_content
        }
    }


@tool
async def propose_delete_note(note_id: str, note_title: str) -> dict:
    """
    Propose deleting a note. Returns preview — never deletes directly.
    """
    try:
        uuid.UUID(note_id)
    except ValueError:
        return {"error": f"Invalid note ID '{note_id}'. You MUST use the `search_vault` tool to find the exact, valid UUID format note_id first for the note titled '{note_title}'."}

    return {
        "action_type": "delete_note",
        "note_id": note_id,
        "note_title": note_title,
        "preview_message": f"I want to permanently delete note '{note_title}'. Allow?",
        "diff": {
            "before": f"Note content will be permanently deleted.",
            "after": None
        }
    }
