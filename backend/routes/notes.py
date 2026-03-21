from __future__ import annotations
"""Note CRUD and search routes."""

import uuid
import asyncio
import json
import time
from fastapi import APIRouter, Depends, Query, HTTPException, BackgroundTasks, UploadFile, File, Form
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from models import Note, NoteLink, Topic, User, NoteMemoryState, RetrievalLog
from schemas import (
    NoteCreate, NoteOut, NoteListOut, NoteLinkOut,
    SearchResult, SearchResponse, RAGResponse,
    RelatedNotesResponse, NoteYoutubeCreate,
    YoutubeSummarizeRequest, TagUpdate, SuggestTagsResponse, NoteUpdate
)
from services.embedding import get_embedding
from services.revision_selector import initialize_memory_state, refresh_user_retention
from services.llm import summarize_youtube_video
from services.agent import rag_agent
from services.language import detect_language
from services.pipeline import process_note
from services.transcription import transcribe_youtube, transcribe_audio_file
from services.tagging import generate_tags
from middleware.auth import get_current_user, CurrentUser
from langsmith.run_helpers import get_current_run_tree
from config import get_settings
import urllib.parse
import yt_dlp

_last_retention_refresh: dict = {}

settings = get_settings()

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

    # Duplicate guard — if a note from this URL already exists for this user, reject it
    if body.source_url:
        existing = await db.execute(
            select(Note).where(
                Note.source_url == body.source_url,
                Note.user_id == current_user.id
            ).limit(1)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail="A note from this URL already exists in your vault."
            )

    content = body.content
    
    # Process HTML content from the web extension using BeautifulSoup
    if "<p" in content.lower() or "<div" in content.lower() or "<article" in content.lower() or "<span" in content.lower():
        from services.scraper import extract_text, strip_metadata_lines
        content = extract_text(content)
        content = strip_metadata_lines(content)

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

    if body.annotation:
        transcript_text = f"[{lang.upper()} User Annotation]: {body.annotation}\n\n{transcript_text}"

    # 3. Save to DB with actual video title
    note = Note(
        title=video_title,
        content=transcript_text,
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
    # Recalculate retention scores inline (replaces APScheduler cron on serverless)
    user_key = str(current_user.id)
    now = time.time()
    if now - _last_retention_refresh.get(user_key, 0) > 600:
        await refresh_user_retention(db, current_user.id)
        _last_retention_refresh[user_key] = now

    backlink_subquery = (
        select(func.count(NoteLink.id))
        .where(NoteLink.target_id == Note.id)
        .correlate(Note)
        .scalar_subquery()
    )

    query = (
        select(Note, NoteMemoryState.estimated_retention, NoteMemoryState.review_count, backlink_subquery.label("backlink_count"))
        .outerjoin(NoteMemoryState, (Note.id == NoteMemoryState.note_id) & (NoteMemoryState.user_id == current_user.id))
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
    rows = result.all()

    # Fetch all topic names in ONE query
    topic_ids = [n.topic_id for n, _, _, _ in rows if n.topic_id]
    topic_map = {}
    if topic_ids:
        topic_result = await db.execute(
            select(Topic).where(Topic.id.in_(topic_ids))
        )
        for t in topic_result.scalars().all():
            topic_map[t.id] = t.name

    out = []
    for n, retention, review_count, backlinks in rows:
        item = NoteListOut(
            id=n.id,
            title=n.title,
            content=n.content,
            summary=n.summary,
            tags=n.tags,
            auto_tags=n.auto_tags,
            user_tags=n.user_tags,
            topic_id=n.topic_id,
            topic_name=topic_map.get(n.topic_id) if n.topic_id else None,
            source_url=n.source_url,
            language=n.language,
            is_processed=n.is_processed,
            processed=n.processed,
            created_at=n.created_at,
            updated_at=n.updated_at,
            backlink_count=backlinks or 0,
            view_count=review_count or 0,
            estimated_retention=retention,
        )
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

    # ── Hybrid Search: Vector + BM25 + RRF Fusion ──────────────

    # Run both searches concurrently
    fetch_k = top_k * 3  # fetch more candidates before fusion

    query_embedding = await get_embedding(q)

    vector_task = db.execute(
        text("""
            SELECT id, title, summary, tags, auto_tags, user_tags,
                   topic_id, source_url, language, is_processed, processed, created_at,
                   1 - (embedding <=> CAST(:emb AS vector)) as similarity
            FROM notes
            WHERE embedding IS NOT NULL
              AND user_id = CAST(:uid AS uuid)
              AND 1 - (embedding <=> CAST(:emb AS vector)) >= :threshold
            ORDER BY embedding <=> CAST(:emb AS vector)
            LIMIT :fetch_k
        """),
        {
            "emb": str(query_embedding),
            "fetch_k": fetch_k,
            "uid": str(current_user.id),
            "threshold": settings.search_similarity_threshold,
        },
    )

    bm25_task = db.execute(
        text("""
            SELECT id, title, summary, tags, auto_tags, user_tags,
                   topic_id, source_url, language, is_processed, processed, created_at,
                   ts_rank(fts, plainto_tsquery('english', :q)) as bm25_score
            FROM notes
            WHERE fts IS NOT NULL
              AND user_id = CAST(:uid AS uuid)
              AND fts @@ plainto_tsquery('english', :q)
            ORDER BY bm25_score DESC
            LIMIT :fetch_k
        """),
        {
            "q": q,
            "fetch_k": fetch_k,
            "uid": str(current_user.id),
        },
    )

    vector_result, bm25_result = await asyncio.gather(vector_task, bm25_task)
    vector_rows = vector_result.all()
    bm25_rows = bm25_result.all()

    # ── RRF Fusion ──────────────────────────────────────────────
    # score(note) = 1/(60 + vector_rank) + 1/(60 + bm25_rank)
    # Notes in both lists score highest. Neither list dominates.

    RRF_K = 60
    rrf_scores: dict[str, float] = {}
    note_data: dict[str, tuple] = {}

    for rank, row in enumerate(vector_rows):
        note_id = str(row[0])
        rrf_scores[note_id] = rrf_scores.get(note_id, 0) + 1 / (RRF_K + rank + 1)
        note_data[note_id] = row  # store full row keyed by id

    for rank, row in enumerate(bm25_rows):
        note_id = str(row[0])
        rrf_scores[note_id] = rrf_scores.get(note_id, 0) + 1 / (RRF_K + rank + 1)
        if note_id not in note_data:
            note_data[note_id] = row  # add BM25-only notes not in vector results

    # Sort by combined RRF score, take top_k
    ranked_ids = sorted(rrf_scores, key=lambda x: rrf_scores[x], reverse=True)[:top_k]

    search_results = []
    contexts = []

    for note_id in ranked_ids:
        row = note_data[note_id]
        _, title, summary, tags, auto_tags, user_tags, topic_id, source_url, lang, is_processed, processed, created_at, _ = row

        topic_name = None
        if topic_id:
            topic = await db.get(Topic, topic_id)
            if topic:
                topic_name = topic.name

        search_results.append(SearchResult(
            note=NoteListOut(
                id=uuid.UUID(note_id),
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
            similarity=round(rrf_scores[note_id], 4),  # RRF score used as similarity
        ))

        if summary:
            contexts.append(f"Title: {title}\n{summary}")
        elif title:
            contexts.append(f"Title: {title}")

    # ── Live retrieval logging ──────────────────────────────────
    try:
        scores = [r.similarity for r in search_results]
        log = RetrievalLog(
            user_id=current_user.id,
            query_text=q,
            notes_returned=len(scores),
            avg_similarity=round(sum(scores) / len(scores), 4) if scores else None,
            top_similarity=round(max(scores), 4) if scores else None,
            min_similarity=round(min(scores), 4) if scores else None,
        )
        db.add(log)
        await db.flush()
    except Exception:
        pass  # logging must never break search
    # ───────────────────────────────────────────────────────────

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
                      AND 1 - (embedding <=> CAST(:emb AS vector)) >= :threshold
                    ORDER BY embedding <=> CAST(:emb AS vector)
                    LIMIT :top_k
                """),
                {
                 "emb": str(list(existing.embedding)), 
                 "note_id": str(existing.id), 
                 "top_k": top_k, 
                 "uid": str(current_user.id),
                 "threshold": settings.search_similarity_threshold
                },
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
              AND 1 - (embedding <=> CAST(:emb AS vector)) >= :threshold
            ORDER BY embedding <=> CAST(:emb AS vector)
            LIMIT :top_k
        """),
        {"emb": str(query_embedding), "top_k": top_k, "uid": str(current_user.id), "threshold": settings.search_similarity_threshold},
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

    note.is_processed = False
    await db.commit()

    background_tasks.add_task(process_note, note.id, bypass_cache=True)
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


@router.patch("/{note_id}", response_model=NoteOut)
async def update_note(
    note_id: uuid.UUID,
    body: NoteUpdate,
    background_tasks: BackgroundTasks,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Update a note's title and/or content — must belong to current user."""
    note = await db.get(Note, note_id)
    if not note or note.user_id != current_user.id:
        raise HTTPException(404, "Note not found")
        
    needs_reprocessing = False
    
    if body.title is not None and body.title != note.title:
        note.title = body.title
        needs_reprocessing = True
    if body.content is not None and body.content != note.content:
        note.content = body.content
        needs_reprocessing = True
        
    if needs_reprocessing:
        note.is_processed = False
        
    await db.commit()
    
    if needs_reprocessing:
        background_tasks.add_task(process_note, note.id)

    return await _note_with_backlinks(db, note)


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
            
    # Get memory state to attach estimated retention
    mem_result = await db.execute(select(NoteMemoryState.estimated_retention).where(NoteMemoryState.note_id == note.id))
    retention = mem_result.scalar_one_or_none()

    out = _note_to_out(note, backlinks)
    out.topic_name = topic_name
    out.estimated_retention = retention
    return out
