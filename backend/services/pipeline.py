from __future__ import annotations
"""AI processing pipeline — orchestrates embedding, summary, concepts, clustering, and linking."""

import uuid
import logging
from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import AsyncSession

from models import Note, NoteLink
from services.embedding import get_embedding
from services.llm import generate_summary, extract_concepts
from services.language import detect_language
from services.tagging import generate_tags
from services.clustering import cluster_notes
import asyncio
from config import get_settings
from database import async_session

settings = get_settings()
logger = logging.getLogger(__name__)


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

    try:
        embedding = await get_embedding(full_text)
    except Exception as e:
        logger.error(f"Embedding failed for note {note_id}: {e}", exc_info=True)
        return  # Cannot proceed without embedding

    summary = content[:300] + "..."
    lang = detect_language(content)
    try:
        summary = await generate_summary(content, content_language=lang)
    except Exception as e:
        logger.warning(f"Summary generation failed: {e}")

    key_concepts: list[str] = []
    try:
        key_concepts = await extract_concepts(content)
    except Exception as e:
        logger.warning(f"Concept extraction failed: {e}")

    # --- Step 3: Write all results in a single clean DB transaction ---
    async with async_session() as db:
        try:
            await db.rollback()  # ensure clean slate on any pooled connection
            note = await db.get(Note, note_id)
            if not note:
                return

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

            # Bidirectional links
            try:
                async with db.begin_nested():
                    await _create_links(db, note_id, embedding)
            except Exception as e:
                logger.warning(f"Link creation failed: {e}")

            note.is_processed = True
            note.processed = True
            await db.commit()
            
            logger.info(f"✅ Successfully processed note: {title}")
            
            # --- Auto Clustering ---
            # Fire-and-forget background task to re-run KMeans
            asyncio.create_task(cluster_notes())

        except Exception as e:
            logger.error(f"Pipeline DB write failed for note {note_id}: {e}", exc_info=True)
            await db.rollback()


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
