from __future__ import annotations
"""Note CRUD and search routes."""

import uuid
import asyncio
import json
from fastapi import APIRouter, Depends, Query, HTTPException, BackgroundTasks, UploadFile, File, Form
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from models import Note, NoteLink, Topic, User
from schemas import (
    NoteCreate, NoteOut, NoteListOut, NoteLinkOut,
    SearchResult, SearchResponse, RAGResponse,
    RelatedNotesResponse, NoteYoutubeCreate,
    YoutubeSummarizeRequest, TagUpdate, SuggestTagsResponse
)
from services.embedding import get_embedding
from services.llm import summarize_youtube_video
from services.agent import rag_agent
from services.language import detect_language
from services.pipeline import process_note
from services.transcription import transcribe_youtube, transcribe_audio_file
from services.tagging import generate_tags
from middleware.auth import get_current_user, CurrentUser
from langsmith.run_helpers import get_current_run_tree
import urllib.parse
import yt_dlp

router = APIRouter(prefix="/notes", tags=["notes"])


@router.post("", response_model=NoteOut, status_code=201)
async def create_note(
    body: NoteCreate,
    background_tasks: BackgroundTasks,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Create a new note and trigger async AI processing."""
    run = get_current_run_tree()
    if run:
        run.metadata["user_id"] = str(current_user.id)
        run.metadata["username"] = current_user.email or "unknown"

    content = body.content
    if body.annotation:
        content = f"[User Annotation]: {body.annotation}\n\n{content}"

    note = Note(
        title=body.title,
        content=content,
        source_url=body.source_url,
        tags=body.tags or [],
        user_id=current_user.id,
    )
    db.add(note)
    await db.flush()
    await db.refresh(note)

    # Trigger async processing
    background_tasks.add_task(process_note, note.id)

    return _note_to_out(note)


def get_youtube_title(video_url: str) -> str:
    """Fetch video title via yt-dlp metadata only — no download."""
    try:
        ydl_opts = {
            'quiet': True,
            'skip_download': True,
            'extract_flat': True,
            'http_headers': {
                'User-Agent': (
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) '
                    'Chrome/120.0.0.0 Safari/537.36'
                ),
            },
            'extractor_args': {'youtube': {'player_client': ['web']}},
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
            return info.get('title', 'YouTube Video')
    except Exception:
        return 'YouTube Video'


@router.post("/youtube", response_model=NoteOut, status_code=201)
async def create_youtube_note(
    body: NoteYoutubeCreate,
    background_tasks: BackgroundTasks,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Fetch YouTube transcript, summarize via LLM, and save as a new note.

    Accepts an optional `transcript` field — if provided (e.g. from the
    Chrome extension which extracts captions client-side), the server
    skips its own transcription step.  This works around YouTube blocking
    cloud-provider IPs.
    """
    run = get_current_run_tree()
    if run:
        run.metadata["user_id"] = str(current_user.id)
        run.metadata["username"] = current_user.email or "unknown"
        run.metadata["video_url"] = body.video_url

    # 0. Title — prefer client-provided, else fetch via yt-dlp
    video_title = body.title or get_youtube_title(body.video_url)

    # 1. Transcript — prefer client-provided, else fetch server-side
    if body.transcript and body.transcript.strip():
        transcript_text = body.transcript.strip()
        lang = detect_language(transcript_text)
    else:
        try:
            transcript_text, lang = await transcribe_youtube(body.video_url)
        except Exception as e:
            if "blocked" in str(e).lower() or "bot" in str(e).lower() or "ip" in str(e).lower():
                raise HTTPException(
                    status_code=422,
                    detail="YouTube blocked captions on this server. "
                           "Please use the MindVault Chrome extension to save YouTube videos — "
                           "it extracts transcripts directly from your browser."
                )
            raise HTTPException(status_code=400, detail=f"Transcription failed: {str(e)}")

    # 2. Ask LLM to summarize natively
    try:
        summary_content = await summarize_youtube_video(transcript_text, content_language=lang)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM summarization failed: {str(e)}")

    if body.annotation:
        summary_content = f"[{lang.upper()} User Annotation]: {body.annotation}\n\n{summary_content}"

    # 3. Save to DB with actual video title
    note = Note(
        title=video_title,
        content=summary_content,
        source_url=body.video_url,
        tags=["youtube", "video"],
        language=lang,
        user_id=current_user.id,
    )
    db.add(note)
    await db.flush()
    await db.refresh(note)

    # 4. Trigger standard AI async embedding / linking pipeline
    background_tasks.add_task(process_note, note.id)

    return _note_to_out(note)


@router.post("/audio", response_model=NoteOut, status_code=201)
async def create_audio_note(
    audio: UploadFile = File(...),
    title: str = Form(""),
    user_tags: str = Form("[]"),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Transcribe an uploaded audio file and save it as a new note."""
    run = get_current_run_tree()
    if run:
        run.metadata["user_id"] = str(current_user.id)
        run.metadata["username"] = current_user.email or "unknown"

    try:
        parsed_tags = json.loads(user_tags)
    except Exception:
        parsed_tags = []

    # 1. Transcribe audio using Groq Whisper
    try:
        transcript_text, lang = await transcribe_audio_file(audio.file, audio.filename)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Audio transcription failed: {str(e)}")

    if not transcript_text or not transcript_text.strip():
        raise HTTPException(status_code=400, detail="Audio was empty or indiscernible.")

    # 2. Save to DB
    note = Note(
        title=title or "[Voice Note]",
        content=transcript_text,
        source_url="MindVault Web (Voice)",
        tags=["voice", "audio"],
        user_tags=parsed_tags,
        language=lang,
        user_id=current_user.id,
    )
    db.add(note)
    await db.flush()
    await db.refresh(note)

    # 3. Trigger async processing for summary, auto-tags, embeddings
    background_tasks.add_task(process_note, note.id)

    return _note_to_out(note)


@router.post("/youtube-summarize")
async def summarize_youtube_note(
    req: YoutubeSummarizeRequest,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Summarize a YouTube video using a transcript pre-extracted by the client.
    This entirely avoids backend YouTube IP blocks.
    """
    content = req.transcript
    if req.annotation:
        content = f"{req.annotation}\n\n{content}"

    # detect language from transcript
    lang = detect_language(content[:500])

    # save note with transcript as content
    # pipeline will summarize, tag, and embed it
    note = Note(
        content=content,
        title=req.video_title,
        source_url=req.video_url,
        language=lang,
        user_id=current_user.id,
        tags=["youtube", "video"]
    )
    db.add(note)
    await db.flush()
    await db.refresh(note)
    note_id = note.id

    # CRITICAL: commit the note so process_note()'s own DB session can see it.
    # process_note() opens an independent async_session() internally — without
    # this commit, that session cannot read the uncommitted row and silently
    # returns "Note not found", leaving summary/tags/embedding empty.
    await db.commit()

    # run summarization pipeline synchronously to return processed result
    await process_note(note_id)

    # re-fetch the fully processed note (our session's cached object is stale)
    processed = await db.execute(select(Note).where(Note.id == note_id))
    processed_note = processed.scalar_one()

    # Use mode="json" so UUID id is serialized as a plain string,
    # ensuring popup.js can build the note link correctly (Bug 2 fix)
    out_dict = _note_to_out(processed_note).model_dump(mode="json")
    out_dict["warning"] = req.warning or ""
    out_dict["extraction_method"] = req.extraction_method

    return out_dict


@router.get("", response_model=list[NoteListOut])
async def list_notes(
    topic_id: uuid.UUID | None = Query(None),
    tag: str | None = Query(None),
    language: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """List all notes with optional filters — scoped to current user."""
    query = (
        select(Note)
        .where(Note.user_id == current_user.id)
        .order_by(Note.created_at.desc())
    )

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
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Semantic search via pgvector cosine similarity, with optional RAG synthesis — scoped to current user."""
    run = get_current_run_tree()
    if run:
        run.metadata["user_id"] = str(current_user.id)
        run.metadata["query"] = q
        run.metadata["rag_enabled"] = synthesize

    # Generate query embedding
    query_embedding = await get_embedding(q)

    # Search via pgvector — scoped to current user
    result = await db.execute(
        text("""
            SELECT id, title, summary, tags, auto_tags, user_tags, topic_id, source_url, language, is_processed, processed, created_at,
                   1 - (embedding <=> CAST(:emb AS vector)) as similarity
            FROM notes
            WHERE embedding IS NOT NULL
              AND user_id = CAST(:uid AS uuid)
            ORDER BY embedding <=> CAST(:emb AS vector)
            LIMIT :top_k
        """),
        {"emb": str(query_embedding), "top_k": top_k, "uid": str(current_user.id)},
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
            initial_state = {
                "query": q,
                "retrieved_notes": [],
                "final_answer": "",
                "sources": [],
                "user_id": str(current_user.id),
            }
            final_state = await rag_agent.ainvoke(initial_state)
            rag = RAGResponse(
                answer=final_state.get("final_answer", ""),
                sources=final_state.get("sources", [])
            )
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
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Find notes related to a URL or content snippet — scoped to current user."""
    if not url and not content:
        raise HTTPException(400, "Provide either 'url' or 'content' query parameter")

    # If URL provided, try to find exact match first
    if url:
        result = await db.execute(
            select(Note).where(Note.source_url == url, Note.user_id == current_user.id).limit(1)
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
                      AND user_id = CAST(:uid AS uuid)
                    ORDER BY embedding <=> CAST(:emb AS vector)
                    LIMIT :top_k
                """),
                {"emb": str(list(existing.embedding)), "note_id": str(existing.id), "top_k": top_k, "uid": str(current_user.id)},
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
              AND user_id = CAST(:uid AS uuid)
            ORDER BY embedding <=> CAST(:emb AS vector)
            LIMIT :top_k
        """),
        {"emb": str(query_embedding), "top_k": top_k, "uid": str(current_user.id)},
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
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Get a single note with backlinks — must belong to current user."""
    note = await db.get(Note, note_id)
    if not note or note.user_id != current_user.id:
        raise HTTPException(404, "Note not found")

    return await _note_with_backlinks(db, note)


@router.post("/{note_id}/process", status_code=202)
async def trigger_processing(
    note_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger AI processing for a note — must belong to current user."""
    note = await db.get(Note, note_id)
    if not note or note.user_id != current_user.id:
        raise HTTPException(404, "Note not found")

    background_tasks.add_task(process_note, note.id)
    return {"message": "Processing started", "note_id": str(note_id)}


@router.delete("/{note_id}", status_code=204)
async def delete_note(
    note_id: uuid.UUID,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Delete a note — must belong to current user."""
    note = await db.get(Note, note_id)
    if not note or note.user_id != current_user.id:
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
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Manually update a note's user_tags — must belong to current user."""
    note = await db.get(Note, note_id)
    if not note or note.user_id != current_user.id:
        raise HTTPException(404, "Note not found")
        
    # Standardize tags
    new_tags = [t.strip().lower() for t in body.tags if t.strip()]
    note.user_tags = list(set(new_tags)) # deduplicate
    
    await db.commit()
    return await _note_with_backlinks(db, note)


@router.post("/{note_id}/suggest-tags", response_model=SuggestTagsResponse)
async def suggest_note_tags(
    note_id: uuid.UUID,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Generate dynamic tag suggestions for a note — must belong to current user."""
    note = await db.get(Note, note_id)
    if not note or note.user_id != current_user.id:
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
