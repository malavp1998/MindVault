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
import concurrent.futures

from models import Note, Topic
from services.llm import llm_complete
from database import async_session

logger = logging.getLogger(__name__)

# ── Dedicated executor to prevent UMAP from starving the default asyncio thread pool ──
# We restrict it to 1 thread so multiple rapid clustering requests don't swamp the CPU
clustering_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)

# ── In-memory cache of fitted clusterer for incremental predictions ────────
_fitted_clusterer = None
_fitted_reducer_cluster = None
_fitted_reducer_2d = None
_notes_since_full_cluster: dict[str, int] = {}
FULL_RECLUSTER_THRESHOLD = 20


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
    Parameters scale with vault size to preserve local cluster structure
    on small datasets while remaining efficient on large ones.
    """
    import umap
    import hdbscan as hdbscan_lib

    n = len(X)

    # ── Step 1: UMAP for clustering (higher dims, tight structure) ──
    # n_neighbors scales to ~1/6 of vault size, capped at 15
    # This keeps neighborhood coverage at ~15-20% regardless of vault size
    n_neighbors = min(max(3, n // 6), 15)
    n_components_cluster = min(max(2, n // 8), 15) if n > 4 else 2

    reducer_cluster = umap.UMAP(
        n_components=n_components_cluster,
        n_neighbors=n_neighbors,
        min_dist=0.0,
        metric="cosine",
        low_memory=False,
        n_jobs=1,
    )
    X_reduced = reducer_cluster.fit_transform(X)

    # ── Step 2: HDBSCAN clustering ──
    # min_cluster_size ~6-7% of vault — allows more clusters to form
    # cluster_selection_method: "leaf" for small vaults (less merging),
    #                           "eom" for large vaults (handles density variation)
    min_cluster_size = max(2, n // 15)

    clusterer = hdbscan_lib.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=1,
        metric="euclidean",
        cluster_selection_method="leaf" if n < 100 else "eom",
        prediction_data=True,
        core_dist_n_jobs=1,
    )
    labels = clusterer.fit_predict(X_reduced)
    probabilities = clusterer.probabilities_

    # ── Step 3: UMAP 2D for graph layout ──
    n_neighbors_2d = min(max(3, n // 6), 15)  # same scaling for visual consistency
    reducer_2d = umap.UMAP(
        n_components=2,
        n_neighbors=n_neighbors_2d,
        min_dist=0.3,
        metric="cosine",
        low_memory=False,
        n_jobs=1,
    )
    coords_2d = reducer_2d.fit_transform(X)

    # Cache for incremental use
    global _fitted_clusterer, _fitted_reducer_cluster, _fitted_reducer_2d
    _fitted_clusterer = clusterer
    _fitted_reducer_cluster = reducer_cluster
    _fitted_reducer_2d = reducer_2d

    return labels, probabilities, coords_2d


async def cluster_notes(user_id: uuid.UUID | None = None) -> None:
    """
    Fetch all embeddings → UMAP + HDBSCAN cluster → upsert Topics → store 2D coords.
    Falls back to KMeans-style single-cluster assignment for vaults with < 5 notes.
    """
    logger.info(f"[cluster_notes] Starting for user_id={user_id}")
    
    # --- Phase 1: Fetch data (Session 1) ---
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
        except Exception as e:
            logger.error(f"Failed to fetch notes for clustering: {e}")
            return

    # --- Phase 2: Heavy Computation (Outside DB Session) ---
    logger.info(f"Loaded {len(notes_db)} notes. DB connection released. Starting computation.")
    if len(notes_db) < 5:
        # Tiny vault: assign all to cluster 0, skip UMAP
        labels = [0] * len(notes_db)
        probabilities = [1.0] * len(notes_db)
        coords_2d = np.random.randn(len(notes_db), 2) * 100
    else:
        try:
            labels, probabilities, coords_2d = await asyncio.wait_for(
                asyncio.get_running_loop().run_in_executor(
                    clustering_executor, _run_umap_hdbscan, X
                ),
                timeout=300.0,
            )
        except asyncio.TimeoutError:
            logger.error("Clustering timed out after 300s — skipping this run")
            return
        except Exception as e:
            logger.error(f"Clustering failed: {e}")
            return

    logger.info(
        f"HDBSCAN: {len(notes_db)} notes → "
        f"{len(set(l for l in labels if l >= 0))} clusters, "
        f"{sum(1 for l in labels if l == -1)} outliers"
    )

    unique_cluster_ids = sorted(set(l for l in labels if l >= 0))
    cluster_topics = {}

    for cluster_id in unique_cluster_ids:
        cluster_indices = [i for i, l in enumerate(labels) if l == cluster_id]
        cluster_contents = [contents[i] for i in cluster_indices]

        try:
            topic_name = await asyncio.wait_for(
                _generate_topic_name(cluster_contents),
                timeout=15.0,
            )
        except (asyncio.TimeoutError, Exception) as e:
            logger.warning(f"Topic naming failed ({e}), using fallback name")
            topic_name = "General Notes"
        cluster_topics[cluster_id] = topic_name.strip()[:100]

    # --- Phase 3: Write Results (Session 2) ---
    logger.info("Computations complete. Re-opening DB connection to save results.")
    async with async_session() as db:
        try:
            await db.rollback() # Ensure cleanliness
            
            # Re-fetch notes to update them
            result = await db.execute(select(Note).where(Note.id.in_(note_ids)))
            raw_notes = result.scalars().all()
            notes_by_id = {n.id: n for n in raw_notes}

            # ── Store 2D coordinates on each note ──
            for i, nid in enumerate(note_ids):
                note = notes_by_id.get(nid)
                if note:
                    note.graph_x = float(coords_2d[i, 0])
                    note.graph_y = float(coords_2d[i, 1])

            # ── Upsert Topics per cluster ───────────────────────────────
            for cluster_id in unique_cluster_ids:
                cluster_indices = [i for i, l in enumerate(labels) if l == cluster_id]
                cluster_note_ids = [note_ids[i] for i in cluster_indices]
                topic_name = cluster_topics[cluster_id]

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


async def assign_new_note_incremental(note_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """
    Try to assign a single new note to an existing cluster without re-running
    the full pipeline. Returns True if successful, False if a full recluster
    is needed instead.
    """
    if (
        _fitted_clusterer is None
        or _fitted_reducer_cluster is None
        or _fitted_reducer_2d is None
    ):
        return False   # cold cache → caller must fall back to full cluster_notes()

    async with async_session() as db:
        note = await db.get(Note, note_id)
        if note is None or note.embedding is None:
            return False
        embedding = np.array(note.embedding).reshape(1, -1)

    # Run transforms in thread pool (they release the GIL but still take time)
    loop = asyncio.get_running_loop()

    def _predict():
        from hdbscan import approximate_predict
        X_reduced = _fitted_reducer_cluster.transform(embedding)
        labels, strengths = approximate_predict(_fitted_clusterer, X_reduced)
        coord_2d = _fitted_reducer_2d.transform(embedding)
        return int(labels[0]), float(strengths[0]), coord_2d[0]

    label, strength, coord = await loop.run_in_executor(clustering_executor, _predict)

    async with async_session() as db:
        note = await db.get(Note, note_id)
        if note is None:
            return False

        note.graph_x = float(coord[0])
        note.graph_y = float(coord[1])

        if label == -1:
            # Outlier — leave topic_id as None for now; full recluster will handle it
            note.topic_id = None
        else:
            # Find the Topic row that corresponds to this cluster_id
            result = await db.execute(
                select(Topic).where(
                    Topic.cluster_id == label,
                    Topic.user_id == user_id,
                )
            )
            topic = result.scalar_one_or_none()
            if topic:
                note.topic_id = topic.id
                topic.note_count = (topic.note_count or 0) + 1
            else:
                note.topic_id = None  # orphan cluster — trigger recluster soon

        await db.commit()

    return True
