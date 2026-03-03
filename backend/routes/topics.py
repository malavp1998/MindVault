from __future__ import annotations
"""Topic routes."""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Topic, Note, User
from schemas import TopicOut
from services.llm import synthesize_answer
from services.clustering import cluster_notes
from middleware.auth import get_current_user, CurrentUser
import asyncio

router = APIRouter(prefix="/topics", tags=["topics"])


@router.get("", response_model=list[TopicOut])
async def list_topics(
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """List all topics with note counts — scoped to current user."""
    result = await db.execute(
        select(Topic)
        .where(Topic.user_id == current_user.id)
        .order_by(Topic.note_count.desc())
    )
    topics = result.scalars().all()
    return [
        TopicOut(
            id=t.id,
            name=t.name,
            cluster_id=t.cluster_id,
            description=t.description,
            note_count=t.note_count,
            created_at=t.created_at,
        )
        for t in topics
    ]


@router.get("/{topic_id}", response_model=TopicOut)
async def get_topic(
    topic_id: uuid.UUID,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Get a single topic — must belong to current user."""
    topic = await db.get(Topic, topic_id)
    if not topic or topic.user_id != current_user.id:
        raise HTTPException(404, "Topic not found")
    return TopicOut(
        id=topic.id,
        name=topic.name,
        cluster_id=topic.cluster_id,
        description=topic.description,
        note_count=topic.note_count,
        created_at=topic.created_at,
    )


@router.post("/{topic_id}/summarize")
async def summarize_topic(
    topic_id: uuid.UUID,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Generate a summary for a topic based on its notes — must belong to current user."""
    topic = await db.get(Topic, topic_id)
    if not topic or topic.user_id != current_user.id:
        raise HTTPException(404, "Topic not found")

    # Get all notes in this topic that belong to the current user
    result = await db.execute(
        select(Note)
        .where(Note.topic_id == topic_id, Note.user_id == current_user.id)
        .limit(10)
    )
    notes = result.scalars().all()

    if not notes:
        return {"summary": "No notes in this topic yet."}

    contexts = [f"Title: {n.title}\n{n.summary or n.content[:500]}" for n in notes]
    summary = await synthesize_answer(
        f"Summarize the topic '{topic.name}' based on these notes:",
        contexts,
    )

    # Store the summary
    topic.description = summary
    await db.flush()

    return {"topic_id": str(topic_id), "name": topic.name, "summary": summary}


@router.post("/recluster", status_code=202)
async def trigger_recluster(current_user: User = CurrentUser):
    """Manually trigger background KMeans re-clustering for current user."""
    asyncio.create_task(cluster_notes(user_id=current_user.id))
    return {"message": "Re-clustering started in the background"}
