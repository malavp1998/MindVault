from __future__ import annotations
"""
Clustering service — UMAP + HDBSCAN pipeline (replaces KMeans).

Install: pip install umap-learn hdbscan
"""

import asyncio
import logging
import uuid
import numpy as np
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from models import Note, Topic
from services.llm import llm_complete
from database import async_session

logger = logging.getLogger(__name__)

# ── In-memory cache of fitted clusterer for incremental predictions ────────
_fitted_clusterer = None
_fitted_reducer_cluster = None


async def _generate_topic_name(sample_contents: list[str]) -> str:
    combined = "\n---\n".join(sample_contents[:5])
    prompt = (
        "You are a topic naming system. Given a set of related text excerpts, "
        "generate a short descriptive topic name (2-5 words). "
        "Return ONLY the topic name, nothing else.\n\n"
        f"Texts:\n{combined[:2000]}"
    )
    return await llm_complete(prompt)


def _run_umap_hdbscan(X: np.ndarray):
    """
    Full UMAP → HDBSCAN → UMAP-2D pipeline.
    Returns: (labels, probabilities, coords_2d)
    - labels: int array, -1 = unclassified outlier
    - probabilities: float array [0,1], soft cluster membership confidence
    - coords_2d: float array shape (n, 2), for graph layout
    """
    import umap
    import hdbscan as hdbscan_lib

    n = len(X)

    # ── Step 1: UMAP for clustering (higher dims, tight structure) ──
    n_neighbors = min(15, n - 1)
    n_components_cluster = min(15, n - 2) if n > 4 else 2

    reducer_cluster = umap.UMAP(
        n_components=n_components_cluster,
        n_neighbors=n_neighbors,
        min_dist=0.0,       # tight clusters → better density estimation
        metric="cosine",    # critical for embedding space
        random_state=42,
        low_memory=False,
    )
    X_reduced = reducer_cluster.fit_transform(X)

    # ── Step 2: HDBSCAN clustering ──
    min_cluster_size = max(2, n // 8)  # at least ~12% of notes per cluster

    clusterer = hdbscan_lib.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=1,
        metric="euclidean",             # euclidean on UMAP space is correct
        cluster_selection_method="eom", # excess of mass: handles varied densities
        prediction_data=True,           # enables approximate_predict for new notes
    )
    labels = clusterer.fit_predict(X_reduced)
    probabilities = clusterer.probabilities_

    # ── Step 3: UMAP 2D for graph layout (looser, spread out) ──
    reducer_2d = umap.UMAP(
        n_components=2,
        n_neighbors=n_neighbors,
        min_dist=0.3,       # allow spread for visual clarity
        metric="cosine",
        random_state=42,
        low_memory=False,
    )
    coords_2d = reducer_2d.fit_transform(X)

    # Cache for incremental use
    global _fitted_clusterer, _fitted_reducer_cluster
    _fitted_clusterer = clusterer
    _fitted_reducer_cluster = reducer_cluster

    return labels, probabilities, coords_2d


async def cluster_notes(user_id: uuid.UUID | None = None) -> None:
    """
    Fetch all embeddings → UMAP + HDBSCAN cluster → upsert Topics → store 2D coords.
    Falls back to KMeans-style single-cluster assignment for vaults with < 5 notes.
    """
    logger.info(f"[cluster_notes] Starting for user_id={user_id}")
    async with async_session() as db:
        try:
            query = select(Note).where(Note.embedding.isnot(None))
            if user_id is not None:
                query = query.where(Note.user_id == user_id)
            result = await db.execute(query)
            notes_db = result.scalars().all()

            if len(notes_db) < 1:
                logger.info("Skipping clustering — no notes with embeddings.")
                return

            embeddings = [list(n.embedding) for n in notes_db]
            note_ids = [n.id for n in notes_db]
            contents = [(n.content or "")[:300] for n in notes_db]
            X = np.array(embeddings)

            if len(notes_db) < 5:
                # Tiny vault: assign all to cluster 0, skip UMAP
                labels = [0] * len(notes_db)
                probabilities = [1.0] * len(notes_db)
                coords_2d = np.random.randn(len(notes_db), 2) * 100
            else:
                try:
                    labels, probabilities, coords_2d = await asyncio.wait_for(
                        asyncio.to_thread(_run_umap_hdbscan, X),
                        timeout=120.0,
                    )
                except asyncio.TimeoutError:
                    logger.error("UMAP/HDBSCAN timed out after 120s — skipping clustering run")
                    return

            logger.info(
                f"HDBSCAN: {len(notes_db)} notes → "
                f"{len(set(l for l in labels if l >= 0))} clusters, "
                f"{sum(1 for l in labels if l == -1)} outliers"
            )

            # ── Store 2D coordinates on each note ──────────────────────
            for i, note in enumerate(notes_db):
                note.graph_x = float(coords_2d[i, 0])
                note.graph_y = float(coords_2d[i, 1])

            # ── Upsert Topics per cluster ───────────────────────────────
            unique_cluster_ids = sorted(set(l for l in labels if l >= 0))

            for cluster_id in unique_cluster_ids:
                cluster_indices = [i for i, l in enumerate(labels) if l == cluster_id]
                cluster_note_ids = [note_ids[i] for i in cluster_indices]
                cluster_contents = [contents[i] for i in cluster_indices]

                try:
                    topic_name = await asyncio.wait_for(
                        _generate_topic_name(cluster_contents),
                        timeout=15.0,
                    )
                except (asyncio.TimeoutError, Exception) as e:
                    logger.warning(f"Topic naming failed ({e}), using fallback name")
                    topic_name = "General Notes"
                topic_name = topic_name.strip()[:100]

                # Upsert Topic
                existing_res = await db.execute(
                    select(Topic).where(
                        Topic.cluster_id == cluster_id,
                        Topic.user_id == user_id,
                    )
                )
                topic = existing_res.scalar_one_or_none()

                if topic is None:
                    topic = Topic(
                        name=topic_name,
                        cluster_id=cluster_id,
                        note_count=len(cluster_note_ids),
                        user_id=user_id,
                    )
                    db.add(topic)
                else:
                    topic.name = topic_name
                    topic.note_count = len(cluster_note_ids)

                await db.flush()

                # Set topic centroid as mean of member embeddings
                cluster_embeddings = X[[i for i, l in enumerate(labels) if l == cluster_id]]
                centroid = cluster_embeddings.mean(axis=0).tolist()
                topic.centroid = centroid

                await db.execute(
                    text("UPDATE notes SET topic_id = :t_id WHERE id = ANY(:n_ids)"),
                    {"t_id": str(topic.id), "n_ids": [str(nid) for nid in cluster_note_ids]},
                )

            # Clear topic from outlier notes
            outlier_ids = [note_ids[i] for i, l in enumerate(labels) if l == -1]
            if outlier_ids:
                await db.execute(
                    text("UPDATE notes SET topic_id = NULL WHERE id = ANY(:n_ids)"),
                    {"n_ids": [str(nid) for nid in outlier_ids]},
                )

            # Remove stale Topics no longer in active clusters
            active_cluster_ids = set(unique_cluster_ids)
            if active_cluster_ids:
                if user_id is not None:
                    await db.execute(
                        text(
                            "DELETE FROM topics "
                            "WHERE cluster_id IS NOT NULL "
                            "AND cluster_id != ALL(:ids) "
                            "AND user_id = :uid"
                        ),
                        {"ids": list(active_cluster_ids), "uid": str(user_id)},
                    )
                else:
                    await db.execute(
                        text(
                            "DELETE FROM topics "
                            "WHERE cluster_id IS NOT NULL "
                            "AND cluster_id != ALL(:ids) "
                            "AND user_id IS NULL"
                        ),
                        {"ids": list(active_cluster_ids)},
                    )

            logger.info(
                f"[cluster_notes] Committing {len(unique_cluster_ids)} clusters "
                f"({len(notes_db)} notes) for user_id={user_id}"
            )
            await db.commit()
            logger.info("Clustering complete and committed.")

        except Exception as e:
            await db.rollback()
            logger.error(f"Clustering failed: {e}", exc_info=True)
            raise
