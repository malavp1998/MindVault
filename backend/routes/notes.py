from __future__ import annotations
"""Note CRUD and search routes."""

import uuid
import asyncio
from fastapi import APIRouter, Depends, Query, HTTPException, BackgroundTasks
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from models import Note, NoteLink, Topic
from schemas import (
    NoteCreate, NoteOut, NoteListOut, NoteLinkOut,
    SearchResult, SearchResponse, RAGResponse,
    RelatedNotesResponse, NoteYoutubeCreate,
    TagUpdate, SuggestTagsResponse
)
from services.embedding import get_embedding
from services.llm import summarize_youtube_video
from services.agent import rag_agent
from services.language import detect_language
from services.pipeline import process_note
from services.transcription import transcribe_youtube
from services.tagging import generate_tags
import urllib.parse

router = APIRouter(prefix="/notes", tags=["notes"])


@router.post("", response_model=NoteOut, status_code=201)
async def create_note(
    body: NoteCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Create a new note and trigger async AI processing."""
    content = body.content
    if body.annotation:
        content = f"[User Annotation]: {body.annotation}\n\n{content}"

    note = Note(
        title=body.title,
        content=content,
        source_url=body.source_url,
        tags=body.tags or [],
    )
    db.add(note)
    await db.flush()
    await db.refresh(note)

    # Trigger async processing
    background_tasks.add_task(process_note, note.id)

    return _note_to_out(note)


@router.post("/youtube", response_model=NoteOut, status_code=201)
async def create_youtube_note(
    body: NoteYoutubeCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Fetch YouTube transcript, summarize via LLM, and save as a new note."""
    # 1. Fetch transcript and detect language from the new cloud service
    try:
        transcript_text, lang = await transcribe_youtube(body.video_url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Transcription failed: {str(e)}")

    # 3. Ask LLM to summarize natively
    try:
        summary_content = await summarize_youtube_video(transcript_text, content_language=lang)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM summarization failed: {str(e)}")

    if body.annotation:
        summary_content = f"[{lang.upper()} User Annotation]: {body.annotation}\n\n{summary_content}"

    # 4. Save to DB
    note = Note(
        title=f"YouTube Video",
        content=summary_content,
        source_url=body.video_url,
        tags=["youtube", "video"],
        language=lang,
    )
    db.add(note)
    await db.flush()
    await db.refresh(note)

    # 5. Trigger standard AI async embedding / linking pipeline
    background_tasks.add_task(process_note, note.id)

    return _note_to_out(note)


@router.get("", response_model=list[NoteListOut])
async def list_notes(
    topic_id: uuid.UUID | None = Query(None),
    tag: str | None = Query(None),
    language: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List all notes with optional filters."""
    query = select(Note).order_by(Note.created_at.desc())

    if topic_id:
        query = query.where(Note.topic_id == topic_id)
    if tag:
        query = query.where((Note.auto_tags.contains([tag])) | (Note.user_tags.contains([tag])) | (Note.tags.contains([tag])))
    if language and language != "All":
        query = query.where(Note.language == language)

    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    notes = result.scalars().all()

    out = []
    for n in notes:
        item = NoteListOut(
            id=n.id,
            title=n.title,
            summary=n.summary,
            tags=n.tags,
            auto_tags=n.auto_tags,
            user_tags=n.user_tags,
            topic_id=n.topic_id,
            topic_name=None,
            source_url=n.source_url,
            language=n.language,
            is_processed=n.is_processed,
            processed=n.processed,
            created_at=n.created_at,
        )
        if n.topic_id:
            topic = await db.get(Topic, n.topic_id)
            if topic:
                item.topic_name = topic.name
        out.append(item)

    return out


@router.get("/search", response_model=SearchResponse)
async def search_notes(
    q: str = Query(..., min_length=1),
    top_k: int = Query(10, ge=1, le=50),
    synthesize: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """Semantic search via pgvector cosine similarity, with optional RAG synthesis."""
    # Generate query embedding
    query_embedding = await get_embedding(q)

    # Search via pgvector
    result = await db.execute(
        text("""
            SELECT id, title, summary, tags, auto_tags, user_tags, topic_id, source_url, language, is_processed, processed, created_at,
                   1 - (embedding <=> CAST(:emb AS vector)) as similarity
            FROM notes
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> CAST(:emb AS vector)
            LIMIT :top_k
        """),
        {"emb": str(query_embedding), "top_k": top_k},
    )
    rows = result.all()

    search_results = []
    contexts = []
    for row in rows:
        note_id, title, summary, tags, auto_tags, user_tags, topic_id, source_url, lang, is_processed, processed, created_at, similarity = row

        # Get topic name
        topic_name = None
        if topic_id:
            topic = await db.get(Topic, topic_id)
            if topic:
                topic_name = topic.name

        search_results.append(SearchResult(
            note=NoteListOut(
                id=note_id,
                title=title,
                summary=summary,
                tags=tags or [],
                auto_tags=auto_tags or [],
                user_tags=user_tags or [],
                topic_id=topic_id,
                topic_name=topic_name,
                source_url=source_url,
                language=lang,
                is_processed=is_processed,
                processed=processed,
                created_at=created_at,
            ),
            similarity=round(float(similarity), 4),
        ))

        if summary:
            contexts.append(f"Title: {title}\n{summary}")
        elif title:
            contexts.append(f"Title: {title}")

    # RAG synthesis via LangGraph Agent if requested
    rag = None
    if synthesize:
        try:
            # The agent handles routing, searching, grading, rewriting, and synthesis internally
            initial_state = {
                "query": q,
                "rewritten_query": "",
                "retrieved_notes": [],
                "relevance_score": 0.0,
                "final_answer": "",
                "sources": [],
                "retry_count": 0
            }
            final_state = await rag_agent.ainvoke(initial_state)
            rag = RAGResponse(
                answer=final_state.get("final_answer", ""),
                sources=final_state.get("sources", [])
            )
            # The agent already searched, so we can override the basic search_results
            # just to ensure they match exactly what the agent saw.
            if final_state.get("sources"):
                search_results = final_state["sources"]
        except Exception as e:
            print(f"RAG Agent Error: {e}")
            pass  # Gracefully degrade if LLM / Agent fails

    query_lang = detect_language(q)
    return SearchResponse(results=search_results, rag=rag, query_language=query_lang)


@router.get("/related", response_model=RelatedNotesResponse)
async def get_related_notes(
    url: str | None = Query(None),
    content: str | None = Query(None),
    top_k: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    """Find notes related to a URL or content snippet."""
    if not url and not content:
        raise HTTPException(400, "Provide either 'url' or 'content' query parameter")

    # If URL provided, try to find exact match first
    if url:
        result = await db.execute(
            select(Note).where(Note.source_url == url).limit(1)
        )
        existing = result.scalar_one_or_none()
        if existing and existing.embedding is not None:
            # Use existing note's embedding to find related notes
            result = await db.execute(
                text("""
                    SELECT id, title, summary, tags, topic_id, source_url, language, is_processed, created_at,
                           1 - (embedding <=> CAST(:emb AS vector)) as similarity
                    FROM notes
                    WHERE id != :note_id AND embedding IS NOT NULL
                    ORDER BY embedding <=> CAST(:emb AS vector)
                    LIMIT :top_k
                """),
                {"emb": str(list(existing.embedding)), "note_id": str(existing.id), "top_k": top_k},
            )
            rows = result.all()
            return RelatedNotesResponse(notes=[
                SearchResult(
                    note=NoteListOut(
                        id=r[0], title=r[1], summary=r[2], tags=r[3] or [],
                        topic_id=r[4], source_url=r[5], language=r[6], is_processed=r[7], created_at=r[8],
                    ),
                    similarity=round(float(r[9]), 4),
                )
                for r in rows
            ])

    # Otherwise, compute embedding from content/URL text and search
    search_text = content or url or ""
    query_embedding = await get_embedding(search_text[:4000])

    result = await db.execute(
        text("""
            SELECT id, title, summary, tags, topic_id, source_url, language, is_processed, created_at,
                   1 - (embedding <=> CAST(:emb AS vector)) as similarity
            FROM notes
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> CAST(:emb AS vector)
            LIMIT :top_k
        """),
        {"emb": str(query_embedding), "top_k": top_k},
    )
    rows = result.all()

    return RelatedNotesResponse(notes=[
        SearchResult(
            note=NoteListOut(
                id=r[0], title=r[1], summary=r[2], tags=r[3] or [],
                topic_id=r[4], source_url=r[5], language=r[6], is_processed=r[7], created_at=r[8],
            ),
            similarity=round(float(r[9]), 4),
        )
        for r in rows
    ])


@router.get("/{note_id}", response_model=NoteOut)
async def get_note(
    note_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a single note with backlinks."""
    note = await db.get(Note, note_id)
    if not note:
        raise HTTPException(404, "Note not found")

    return await _note_with_backlinks(db, note)


@router.post("/{note_id}/process", status_code=202)
async def trigger_processing(
    note_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger AI processing for a note."""
    note = await db.get(Note, note_id)
    if not note:
        raise HTTPException(404, "Note not found")

    background_tasks.add_task(process_note, note.id)
    return {"message": "Processing started", "note_id": str(note_id)}


@router.delete("/{note_id}", status_code=204)
async def delete_note(
    note_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Delete a note."""
    note = await db.get(Note, note_id)
    if not note:
        raise HTTPException(404, "Note not found")
        
    # If the note belongs to a topic, decrement the topic's note count
    if note.topic_id:
        topic = await db.get(Topic, note.topic_id)
        if topic:
            topic.note_count -= 1
            if topic.note_count <= 0:
                await db.delete(topic)
                
    await db.delete(note)


@router.patch("/{note_id}/tags", response_model=NoteOut)
async def update_note_tags(
    note_id: uuid.UUID,
    body: TagUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Manually update a note's user_tags without affecting auto_tags."""
    note = await db.get(Note, note_id)
    if not note:
        raise HTTPException(404, "Note not found")
        
    # Standardize tags
    new_tags = [t.strip().lower() for t in body.tags if t.strip()]
    note.user_tags = list(set(new_tags)) # deduplicate
    
    await db.commit()
    return await _note_with_backlinks(db, note)


@router.post("/{note_id}/suggest-tags", response_model=SuggestTagsResponse)
async def suggest_note_tags(
    note_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Generate dynamic tag suggestions for a note (does not save)."""
    note = await db.get(Note, note_id)
    if not note:
        raise HTTPException(404, "Note not found")
        
    suggestions = await generate_tags(note.content, note.language)
    return SuggestTagsResponse(suggested_tags=suggestions)


# ─── Helpers ────────────────────────────────────────────────────

def _note_to_out(note: Note, backlinks: list[NoteLinkOut] | None = None) -> NoteOut:
    return NoteOut(
        id=note.id,
        title=note.title,
        content=note.content,
        source_url=note.source_url,
        tags=note.tags,
        auto_tags=note.auto_tags,
        user_tags=note.user_tags,
        summary=note.summary,
        key_concepts=note.key_concepts,
        topic_id=note.topic_id,
        language=note.language,
        is_processed=note.is_processed,
        processed=note.processed,
        created_at=note.created_at,
        updated_at=note.updated_at,
        backlinks=backlinks or [],
    )


async def _note_with_backlinks(db: AsyncSession, note: Note) -> NoteOut:
    """Build NoteOut including backlinks from both directions."""
    # Outgoing links
    result = await db.execute(
        select(NoteLink, Note)
        .join(Note, NoteLink.target_id == Note.id)
        .where(NoteLink.source_id == note.id)
    )
    outgoing = result.all()

    # Incoming links
    result = await db.execute(
        select(NoteLink, Note)
        .join(Note, NoteLink.source_id == Note.id)
        .where(NoteLink.target_id == note.id)
    )
    incoming = result.all()

    backlink_map: dict[uuid.UUID, NoteLinkOut] = {}
    for link, linked_note in outgoing:
        backlink_map[linked_note.id] = NoteLinkOut(
            id=link.id,
            note_id=linked_note.id,
            title=linked_note.title,
            similarity_score=link.similarity_score,
        )
    for link, linked_note in incoming:
        if linked_note.id not in backlink_map:
            backlink_map[linked_note.id] = NoteLinkOut(
                id=link.id,
                note_id=linked_note.id,
                title=linked_note.title,
                similarity_score=link.similarity_score,
            )

    backlinks = sorted(backlink_map.values(), key=lambda b: b.similarity_score, reverse=True)

    # Get topic name
    topic_name = None
    if note.topic_id:
        topic = await db.get(Topic, note.topic_id)
        if topic:
            topic_name = topic.name

    out = _note_to_out(note, backlinks)
    out.topic_name = topic_name
    return out
