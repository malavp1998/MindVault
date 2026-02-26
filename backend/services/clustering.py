from __future__ import annotations
"""Clustering service — topic auto-assignment and re-clustering."""

import uuid
import numpy as np
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sklearn.cluster import AgglomerativeClustering

from models import Note, Topic
from services.llm import generate_topic_name
from config import get_settings

settings = get_settings()


async def assign_topic(db: AsyncSession, note_id: uuid.UUID, embedding: list[float]) -> uuid.UUID | None:
    """Assign a note to the nearest topic cluster, or create a new one."""
    # Get all existing topics with centroids
    result = await db.execute(select(Topic).where(Topic.centroid.isnot(None)))
    topics = result.scalars().all()

    if not topics:
        # No topics yet — check if we have enough notes to cluster
        count_result = await db.execute(
            select(func.count(Note.id)).where(Note.embedding.isnot(None))
        )
        note_count = count_result.scalar()
        if note_count >= settings.recluster_every_n:
            await recluster_all(db)
            # Re-fetch topics after clustering
            result = await db.execute(select(Topic).where(Topic.centroid.isnot(None)))
            topics = result.scalars().all()
        if not topics:
            return None

    # Find nearest topic by cosine similarity
    emb_array = np.array(embedding)
    best_topic = None
    best_sim = -1.0

    for topic in topics:
        if topic.centroid is not None:
            centroid = np.array(topic.centroid)
            sim = np.dot(emb_array, centroid) / (
                np.linalg.norm(emb_array) * np.linalg.norm(centroid) + 1e-10
            )
            if sim > best_sim:
                best_sim = sim
                best_topic = topic

    # Only assign if similarity is above threshold
    if best_topic and best_sim > 0.3:
        best_topic.note_count += 1
        return best_topic.id

    return None


async def recluster_all(db: AsyncSession) -> list[Topic]:
    """Re-cluster all notes using Agglomerative Clustering."""
    # Fetch all notes with embeddings
    result = await db.execute(
        select(Note.id, Note.embedding, Note.content)
        .where(Note.embedding.isnot(None))
    )
    rows = result.all()

    if len(rows) < 3:
        return []

    note_ids = [r[0] for r in rows]
    embeddings = np.array([list(r[1]) for r in rows])
    contents = [r[2] for r in rows]

    # Determine number of clusters (heuristic: sqrt of note count, min 2, max 20)
    n_clusters = max(2, min(20, int(np.sqrt(len(rows)))))

    # Run agglomerative clustering
    clustering = AgglomerativeClustering(
        n_clusters=n_clusters,
        metric="cosine",
        linkage="average",
    )
    labels = clustering.fit_predict(embeddings)

    # Delete existing topics (and their FK references on notes via topic_id nullable)
    old_topics = (await db.execute(select(Topic))).scalars().all()
    for t in old_topics:
        await db.delete(t)
    await db.flush()

    # Create new topics
    new_topics = []
    for cluster_id in range(n_clusters):
        mask = labels == cluster_id
        cluster_embeddings = embeddings[mask]
        cluster_contents = [contents[i] for i, m in enumerate(mask) if m]
        cluster_note_ids = [note_ids[i] for i, m in enumerate(mask) if m]

        if len(cluster_embeddings) == 0:
            continue

        centroid = cluster_embeddings.mean(axis=0).tolist()

        # Generate topic name from cluster contents
        try:
            name = await generate_topic_name(cluster_contents)
        except Exception:
            name = f"Topic {cluster_id + 1}"

        topic = Topic(
            name=name,
            centroid=centroid,
            note_count=len(cluster_note_ids),
        )
        db.add(topic)
        await db.flush()
        new_topics.append(topic)

        # Assign notes to this topic
        for nid in cluster_note_ids:
            note = await db.get(Note, nid)
            if note:
                note.topic_id = topic.id

    await db.flush()
    return new_topics
