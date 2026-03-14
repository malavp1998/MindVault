from __future__ import annotations
"""MCP Server — exposes MindVault tools for MCP-compatible clients."""

import uuid
from mcp.server.fastmcp import FastMCP

# Disable host header validation for Render deployment
try:
    import mcp.server.streamable_http as _sh
    if hasattr(_sh, 'StreamableHTTPServerTransport'):
        _orig_init = _sh.StreamableHTTPServerTransport.__init__
        def _patched_init(self, *args, **kwargs):
            _orig_init(self, *args, **kwargs)
            self._is_valid_host = lambda host: True
        _sh.StreamableHTTPServerTransport.__init__ = _patched_init
except Exception:
    pass

try:
    from mcp.server import transport_security as _ts
    _ts.is_valid_host = lambda host, allowed_hosts: True
except Exception:
    pass

from database import async_session
from models import Note, Topic, NoteLink
from schemas import NoteCreate
from services.embedding import get_embedding
from services.llm import synthesize_answer
from services.pipeline import process_note
from services.agent import rag_agent
from services.revision_selector import get_revision_queue
from sqlalchemy import select, text

# Create the MCP server
mcp = FastMCP("MindVault", stateless_http=True)


@mcp.tool()
async def search_vault(query: str, user_id: str, top_k: int = 5) -> str:
    """Search the vault for semantically similar notes.

    Args:
        query: The search query text.
        user_id: The UUID of the user. MUST provide this to scope the search.
        top_k: Number of results to return (default 5).

    Returns:
        A formatted string of matching notes with titles, summaries, and similarity scores.
    """
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return "Invalid user ID format. Please provide a valid UUID."

    query_embedding = await get_embedding(query)

    async with async_session() as db:
        result = await db.execute(
            text("""
                SELECT id, title, summary, source_url,
                       1 - (embedding <=> CAST(:emb AS vector)) as similarity
                FROM notes
                WHERE embedding IS NOT NULL
                  AND user_id = CAST(:uid AS uuid)
                ORDER BY embedding <=> CAST(:emb AS vector)
                LIMIT :top_k
            """),
            {"emb": str(query_embedding), "top_k": top_k, "uid": str(uid)},
        )
        rows = result.all()

    if not rows:
        return "No matching notes found in the vault."

    results = []
    for row in rows:
        note_id, title, summary, source_url, similarity = row
        entry = f"📝 **{title}** (similarity: {similarity:.2f})\n"
        if summary:
            entry += f"   Summary: {summary}\n"
        if source_url:
            entry += f"   Source: {source_url}\n"
        entry += f"   ID: {note_id}"
        results.append(entry)

    return f"Found {len(rows)} matching notes:\n\n" + "\n\n".join(results)


@mcp.tool()
async def add_note(content: str, user_id: str, title: str = "Untitled", source: str = "") -> str:
    """Save a new note to the vault and trigger AI processing.

    Args:
        content: The note content text.
        user_id: The UUID of the user. MUST provide this to assign ownership.
        title: Title for the note (default "Untitled").
        source: Source URL if applicable.

    Returns:
        Confirmation message with the new note's ID.
    """
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return "Invalid user ID format. Please provide a valid UUID."

    async with async_session() as db:
        note = Note(
            title=title,
            content=content,
            source_url=source or None,
            tags=[],
            user_id=uid,
        )
        db.add(note)
        await db.commit()
        await db.refresh(note)

    # Trigger async processing
    try:
        await process_note(note.id)
    except Exception:
        pass  # Processing runs best-effort

    return f"✅ Note saved to vault with ID: {note.id}\nTitle: {title}\nProcessing has been triggered."


@mcp.tool()
async def get_related(note_id: str, user_id: str) -> str:
    """Get notes that are linked to a specific note.

    Args:
        note_id: UUID of the note to find related notes for.
        user_id: The UUID of the user. MUST provide this to verify ownership.

    Returns:
        A formatted string of related notes with similarity scores.
    """
    try:
        nid = uuid.UUID(note_id)
    except ValueError:
        return "Invalid note ID format. Please provide a valid UUID."

    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return "Invalid user ID format. Please provide a valid UUID."

    async with async_session() as db:
        note = await db.get(Note, nid)
        if not note or note.user_id != uid:
            return f"Note {note_id} not found in your vault."

        # Get outgoing links — only to notes owned by the same user
        result = await db.execute(
            select(NoteLink, Note)
            .join(Note, NoteLink.target_id == Note.id)
            .where(NoteLink.source_id == nid)
            .where(Note.user_id == uid)
            .order_by(NoteLink.similarity_score.desc())
        )
        links = result.all()

    if not links:
        return f"No related notes found for '{note.title}'."

    results = [f"Related notes for **{note.title}**:\n"]
    for link, linked_note in links:
        results.append(
            f"🔗 **{linked_note.title}** (similarity: {link.similarity_score:.2f})\n"
            f"   ID: {linked_note.id}"
        )

    return "\n\n".join(results)


@mcp.tool()
async def list_topics(user_id: str) -> str:
    """List all auto-generated topic clusters with note counts.

    Args:
        user_id: The UUID of the user. MUST provide this to scope to their topics.

    Returns:
        A formatted string of topics with their names and note counts.
    """
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return "Invalid user ID format. Please provide a valid UUID."

    async with async_session() as db:
        result = await db.execute(
            select(Topic)
            .where(Topic.user_id == uid)
            .order_by(Topic.note_count.desc())
        )
        topics = result.scalars().all()

    if not topics:
        return "No topics have been generated yet. Add more notes to enable clustering."

    results = ["📚 **Vault Topics**\n"]
    for t in topics:
        desc = f" — {t.description[:100]}..." if t.description else ""
        results.append(f"• **{t.name}** ({t.note_count} notes){desc}\n  ID: {t.id}")

    return "\n\n".join(results)


@mcp.tool()
async def summarize_topic(topic_id: str, user_id: str) -> str:
    """Generate an AI summary for a specific topic cluster.

    Args:
        topic_id: UUID of the topic to summarize.
        user_id: The UUID of the user. MUST provide this to verify ownership.

    Returns:
        A synthesized summary of the topic based on its notes.
    """
    try:
        tid = uuid.UUID(topic_id)
    except ValueError:
        return "Invalid topic ID format. Please provide a valid UUID."

    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return "Invalid user ID format. Please provide a valid UUID."

    async with async_session() as db:
        topic = await db.get(Topic, tid)
        if not topic or topic.user_id != uid:
            return f"Topic {topic_id} not found in your vault."

        result = await db.execute(
            select(Note).where(Note.topic_id == tid, Note.user_id == uid).limit(10)
        )
        notes = result.scalars().all()

    if not notes:
        return f"No notes found in topic '{topic.name}'."

    contexts = [f"Title: {n.title}\n{n.summary or n.content[:500]}" for n in notes]

    try:
        summary = await synthesize_answer(
            f"Provide a comprehensive summary of the topic '{topic.name}':",
            contexts,
        )
    except Exception as e:
        return f"Failed to generate summary: {e}"

    return f"📋 **Topic: {topic.name}** ({topic.note_count} notes)\n\n{summary}"


@mcp.tool()
async def chat_with_vault(message: str, user_id: str) -> str:
    """Chat with the entire vault using a RAG agent. The agent will intelligently search notes to answer questions.
    
    Args:
        message: The question or message to ask the vault.
        user_id: The UUID of the user. MUST provide this to scope the search context.
        
    Returns:
        The synthesized answer with citations to the source notes used.
    """
    try:
        uuid.UUID(user_id)
    except ValueError:
        return "Invalid user ID format. Please provide a valid UUID."
        
    initial_state = {
        "query": message,
        "retrieved_notes": [],
        "final_answer": "",
        "sources": [],
        "user_id": user_id,
    }
    
    try:
        final_state = await rag_agent.ainvoke(initial_state)
        answer = final_state.get("final_answer", "")
        sources = final_state.get("sources", [])
        
        response = answer + "\n\n"
        if sources:
            response += "Sources used:\n"
            for s in sources:
                response += f"- {s.note.title} (ID: {s.note.id})\n"
                
        return response
    except Exception as e:
        return f"Agent failed to answer: {e}"


@mcp.tool()
async def get_due_reviews(user_id: str) -> str:
    """Get the notes that are due for spaced repetition review today.
    
    Args:
        user_id: The UUID of the user. MUST provide this to fetch their specific queue.
        
    Returns:
        A list of notes (with titles and content snippets) that the user needs to review today.
    """
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return "Invalid user ID format. Please provide a valid UUID."
        
    async with async_session() as db:
        notes = await get_revision_queue(db, uid)
        
    if not notes:
        return "🎉 You're all caught up! No notes due for review today."
        
    results = [f"📚 **Due for Review Today ({len(notes)} notes)**\n"]
    for note in notes:
        # Notes returned by get_revision_queue are dictionaries based on the NoteOut schema
        results.append(
            f"📝 **{note.get('title', 'Unknown')}** (ID: {note.get('id', 'Unknown')})\n"
            f"   Tags: {', '.join(note.get('tags') or [])}\n"
            f"   Content Preview: {note.get('content', '')[:300]}...\n"
        )
        
    results.append("\nTip: Ask me to quiz you on one of these notes!")
    return "\n\n".join(results)

