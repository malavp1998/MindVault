from __future__ import annotations
"""AI processing pipeline — orchestrates embedding, summary, concepts, clustering, and linking."""

import uuid
import logging
from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import AsyncSession

from models import Note, NoteLink
from services.embedding import get_embedding
from services.llm import generate_summary
from services.language import detect_language
from services.tagging import generate_tags
from services.clustering import cluster_notes, assign_new_note_incremental, _notes_since_full_cluster, FULL_RECLUSTER_THRESHOLD
from services.semantic_cache import invalidate_user_cache
from langsmith import traceable
import asyncio
from config import get_settings
from database import async_session
import json

settings = get_settings()
logger = logging.getLogger(__name__)


@traceable(name="process_note_pipeline", tags=["pipeline", "ingestion"], metadata={"pipeline_version": "1.0"})
async def process_note(note_id: uuid.UUID) -> None:
    """Full AI processing pipeline for a note. Runs asynchronously."""

    # --- Step 1: Load the note in a fresh, clean read-only session ---
    async with async_session() as db:
        try:
            await db.rollback()  # ensure clean slate on any pooled connection
            note = await db.get(Note, note_id)
            if not note:
                logger.error(f"Note {note_id} not found")
                return
            title = note.title
            content = note.content
        except Exception as e:
            logger.error(f"Failed to load note {note_id}: {e}")
            await db.rollback()
            return

    logger.info(f"Processing note: {title}")

    # --- Step 2: Run ALL AI calls OUTSIDE any DB transaction ---
    full_text = f"{title}\n\n{content}"

    embedding: list[float] | None = None
    try:
        embedding = await get_embedding(full_text)
    except Exception as e:
        # Embeddings are used for similarity search/linking/clustering, but we can still
        # generate summaries/tags so the note doesn't stay stuck in "Processing".
        logger.error(f"Embedding failed for note {note_id}: {e}", exc_info=True)

    summary = content[:300] + "..."
    key_concepts: list[str] = []
    lang = detect_language(content)
    try:
        raw_summary = await generate_summary(content, title=title, content_language=lang)
        try:
            parsed = json.loads(raw_summary)

            # Build rich summary string from all new fields
            overview = parsed.get("overview", "")
            detailed = parsed.get("detailed_summary", "")
            insights = parsed.get("insights", [])
            questions = parsed.get("questions_raised", [])
            best_quote = parsed.get("best_quote", "")

            summary = overview
            if detailed:
                summary += f"\n\n{detailed}"
            if insights:
                summary += "\n\n**Insights:**\n" + "\n".join(f"- {i}" for i in insights)
            if questions:
                summary += "\n\n**Questions Raised:**\n" + "\n".join(f"- {q}" for q in questions)
            if best_quote:
                summary += f'\n\n> "{best_quote}"'

            key_concepts = parsed.get("key_concepts", [])

        except (json.JSONDecodeError, ValueError):
            summary = raw_summary
            key_concepts = []
    except Exception as e:
        logger.warning(f"Summary generation failed: {e}")

    # --- Step 3: Write all results in a single clean DB transaction ---
    async with async_session() as db:
        try:
            await db.rollback()  # ensure clean slate on any pooled connection
            note = await db.get(Note, note_id)
            if not note:
                return

            if embedding is not None:
                note.embedding = embedding
            note.summary = summary
            note.key_concepts = key_concepts
            note.language = lang
            
            # --- Auto Tags ---
            try:
                auto_tags = await generate_tags(content, lang)
                note.auto_tags = auto_tags
            except Exception as e:
                logger.warning(f"Auto-tagging failed: {e}")

            # Bidirectional links (requires embedding)
            if embedding is not None:
                try:
                    async with db.begin_nested():
                        await _create_links(db, note_id, embedding)
                except Exception as e:
                    logger.warning(f"Link creation failed: {e}")

            note.is_processed = True
            note.processed = True
            await db.commit()
            
            logger.info(f"✅ Successfully processed note: {title}")
            
            # --- Initialize Spaced Repetition Memory State ---
            if note.user_id:
                from services.revision_selector import initialize_memory_state
                try:
                    await initialize_memory_state(db, note_id, note.user_id)
                except Exception as e:
                    logger.error(f"Failed to initialize memory state for note {note_id}: {e}")
            
            # --- Invalidate user's RAG and chat cache (vault changed) ---
            note_user_id = note.user_id
            if note_user_id:
                await invalidate_user_cache(str(note_user_id), cache_key="rag")
                await invalidate_user_cache(str(note_user_id), cache_key="chat")

            # --- Auto Clustering ---
            # Smart two-path logic: incremental assignment vs full recluster
            if note_user_id:
                user_key = str(note_user_id)
                _notes_since_full_cluster[user_key] = _notes_since_full_cluster.get(user_key, 0) + 1

                if _notes_since_full_cluster[user_key] >= FULL_RECLUSTER_THRESHOLD:
                    # Time for a full recluster
                    _notes_since_full_cluster[user_key] = 0
                    asyncio.create_task(cluster_notes(user_id=note_user_id))
                else:
                    # Try fast incremental assignment
                    asyncio.create_task(_incremental_or_fallback(note_id, note_user_id))
            else:
                asyncio.create_task(cluster_notes())

        except Exception as e:
            logger.error(f"Pipeline DB write failed for note {note_id}: {e}", exc_info=True)
            await db.rollback()


async def _incremental_or_fallback(note_id: uuid.UUID, user_id: uuid.UUID):
    """Try incremental assignment; fall back to full cluster_notes() if the cache was cold."""
    success = await assign_new_note_incremental(note_id, user_id)
    if not success:
        await cluster_notes(user_id=user_id)


async def _create_links(
    db: AsyncSession, note_id: uuid.UUID, embedding: list[float], top_k: int = 3
) -> None:
    """Find top-k similar notes and create bidirectional NoteLink records."""
    # Use pgvector cosine distance to find similar notes
    result = await db.execute(
        text("""
            SELECT id, 1 - (embedding <=> CAST(:emb AS vector)) as similarity
            FROM notes
            WHERE id != :note_id
              AND embedding IS NOT NULL
              AND (user_id = (SELECT user_id FROM notes WHERE id = CAST(:note_id AS uuid)) OR user_id IS NULL)
            ORDER BY embedding <=> CAST(:emb AS vector)
            LIMIT :top_k
        """),
        {"emb": str(embedding), "note_id": str(note_id), "top_k": top_k},
    )
    similar_notes = result.all()

    # Remove existing links for this note
    existing = await db.execute(
        select(NoteLink).where(
            (NoteLink.source_id == note_id) | (NoteLink.target_id == note_id)
        )
    )
    for link in existing.scalars().all():
        await db.delete(link)
    await db.flush()

    # Create new bidirectional links
    for row in similar_notes:
        target_id, similarity = row[0], row[1]
        if similarity < 0.1:  # Skip very dissimilar notes
            continue

        # Forward link
        db.add(NoteLink(
            source_id=note_id,
            target_id=target_id,
            similarity_score=round(float(similarity), 4),
        ))
        # Reverse link
        db.add(NoteLink(
            source_id=target_id,
            target_id=note_id,
            similarity_score=round(float(similarity), 4),
        ))

    await db.flush()
