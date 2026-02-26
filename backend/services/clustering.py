from __future__ import annotations
"""Service for grouping vector embeddings into topics using KMeans clustering."""

import logging
import uuid
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
import numpy as np
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from models import Note, Topic
from services.llm import generate_topic_name
from database import async_session

logger = logging.getLogger(__name__)


async def _generate_topic_name_local(sample_contents: list[str]) -> str:
    """Generate a short descriptive topic name via LLM."""
    from services.llm import llm_complete
    combined = "\n---\n".join(sample_contents[:5])
    prompt = (
        "You are a topic naming system. Given a set of related text excerpts, "
        "generate a short descriptive topic name (2-5 words). "
        "Return ONLY the topic name, nothing else.\n\n"
        f"Texts:\n{combined[:2000]}"
    )
    return await llm_complete(prompt)


async def find_optimal_clusters(embeddings: list[list[float]]) -> int:
    """Automatically find best number of clusters (k) using Silhouette Score."""
    n = len(embeddings)
    if n < 3:
        return 1  # 1 cluster for tiny sets

    max_k = min(5, n - 1)
    best_k = 2
    best_score = -1.0

    X = np.array(embeddings)

    for k in range(2, max_k + 1):
        kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels = kmeans.fit_predict(X)
        score = silhouette_score(X, labels)
        if score > best_score:
            best_score = score
            best_k = k

    return best_k


async def cluster_notes() -> None:
    """
    Fetch all embeddings from DB and dynamically re-cluster using KMeans.
    Run as a background task after every new note is processed.
    """
    async with async_session() as db:
        try:
            # 1. Fetch all notes that have embeddings
            result = await db.execute(
                select(Note).where(Note.embedding.isnot(None))
            )
            notes_db = result.scalars().all()

            if len(notes_db) < 1:
                logger.info("Skipping clustering (zero notes with embeddings found).")
                return

            # 2. Build embedding matrix
            embeddings = []
            note_ids = []
            contents = []
            for n in notes_db:
                embeddings.append(list(n.embedding))
                note_ids.append(n.id)
                contents.append((n.content or "")[:300])

            X = np.array(embeddings)

            # 3. Find optimal K via Silhouette Score
            k = await find_optimal_clusters(embeddings)
            logger.info(f"Re-clustering {len(notes_db)} notes into {k} topics.")

            # 4. Fit KMeans
            if k == 1:
                labels = [0] * len(notes_db)
            else:
                kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
                labels = kmeans.fit_predict(X)

            active_cluster_ids: set[int] = set()

            # 5. For every cluster, upsert a Topic record via ORM
            for cluster_id in range(k):
                cluster_note_ids = [
                    note_ids[i] for i, lbl in enumerate(labels) if lbl == cluster_id
                ]
                cluster_contents = [
                    contents[i] for i, lbl in enumerate(labels) if lbl == cluster_id
                ]

                if not cluster_note_ids:
                    continue

                active_cluster_ids.add(cluster_id)

                # Ask LLM to name the cluster
                topic_name = await _generate_topic_name_local(cluster_contents)
                topic_name = topic_name.strip()[:100]

                # Upsert Topic via ORM (no raw SQL)
                existing_res = await db.execute(
                    select(Topic).where(Topic.cluster_id == cluster_id)
                )
                topic = existing_res.scalar_one_or_none()

                if topic is None:
                    topic = Topic(
                        name=topic_name,
                        cluster_id=cluster_id,
                        note_count=len(cluster_note_ids),
                    )
                    db.add(topic)
                else:
                    topic.name = topic_name
                    topic.note_count = len(cluster_note_ids)

                await db.flush()  # assign topic.id if new

                # Update notes to point to this topic
                await db.execute(
                    text(
                        "UPDATE notes SET topic_id = :t_id WHERE id = ANY(:n_ids)"
                    ),
                    {
                        "t_id": str(topic.id),
                        "n_ids": [str(nid) for nid in cluster_note_ids],
                    },
                )

            # 6. Remove stale topics (orphaned by shrinking K)
            if active_cluster_ids:
                await db.execute(
                    text(
                        "DELETE FROM topics "
                        "WHERE cluster_id IS NOT NULL "
                        "AND cluster_id != ALL(:ids)"
                    ),
                    {"ids": list(active_cluster_ids)},
                )

            await db.commit()
            logger.info(
                f"✅ Successfully clustered {len(notes_db)} notes into {k} topics."
            )

        except Exception as exc:
            logger.error(f"Background clustering failed: {exc}", exc_info=True)
            await db.rollback()
