

---

## MISSION

Upgrade MindVault's graph view from a sparse topic-cluster display to a rich, Obsidian-quality knowledge graph. The current graph shows only topic → note edges with no note-to-note connections, making it look empty. This upgrade adds semantic note-to-note edges, replaces KMeans with UMAP + HDBSCAN clustering, uses UMAP 2D coordinates for layout, and adds Obsidian UX features (local graph mode, depth filter, edge type toggles, node size by degree).

---

## CONTEXT — CURRENT STATE

**Tech stack:**
- Backend: FastAPI async, PostgreSQL 16 + pgvector (Vector(1536)), SQLAlchemy async
- Frontend: React 19, react-force-graph-2d ^1.29.1, D3 ^7.9.0
- Embeddings: Jina AI `jina-embeddings-v3`, stored as `Vector(1536)` on `notes.embedding`
- Clustering: KMeans + silhouette score in `backend/services/clustering.py`
- Graph API: `backend/routes/graph.py` → `GET /api/graph/data`
- Graph UI: `frontend/src/components/GraphView.jsx` + `frontend/src/pages/TopicsPage.jsx`

**Current graph API response shape:**
```json
{
  "nodes": [
    { "id": "topic-uuid", "label": "Deep Learning", "type": "topic", "count": 12 },
    { "id": "note-uuid", "label": "My Note", "type": "note", "tags": ["nlp"], "source_url": "..." }
  ],
  "links": [
    { "source": "topic-uuid", "target": "note-uuid", "type": "topic_link" },
    { "source": "note-A", "target": "note-B", "type": "tag_link", "shared_tag": "nlp" }
  ]
}
```

**Current Note model columns (already exist, do NOT recreate):**
`id, title, content, source_url, tags (JSON), auto_tags (ARRAY), user_tags (ARRAY), summary, key_concepts, language, user_id, topic_id, embedding (Vector(1536)), is_processed, processed, created_at, updated_at`

**NoteLink model already exists:**
`id, source_id (FK notes.id), target_id (FK notes.id), similarity_score (Float)`

---

## CHANGES TO MAKE

### CHANGE 1 — Add DB columns for UMAP coordinates

**File: `backend/models.py`**

Add two new nullable Float columns to the `Note` model:
```python
graph_x: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
graph_y: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
```

Then create an Alembic migration OR add a raw SQL migration script at `backend/migrations/add_graph_coords.sql`:
```sql
ALTER TABLE notes ADD COLUMN IF NOT EXISTS graph_x FLOAT;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS graph_y FLOAT;
```

Apply via the existing `init_db()` flow or document the manual step clearly.

---

### CHANGE 2 — Replace KMeans with UMAP + HDBSCAN

**File: `backend/services/clustering.py`** — full replacement

Replace the entire file with this implementation:

```python
from __future__ import annotations
"""
Clustering service — UMAP + HDBSCAN pipeline (replaces KMeans).

Install: pip install umap-learn hdbscan
"""

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
                labels, probabilities, coords_2d = _run_umap_hdbscan(X)

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

            # Handle outlier notes (label == -1) — assign to a special "Other" topic
            # or leave topic_id as None (they'll float freely in the graph)

            for cluster_id in unique_cluster_ids:
                cluster_indices = [i for i, l in enumerate(labels) if l == cluster_id]
                cluster_note_ids = [note_ids[i] for i in cluster_indices]
                cluster_contents = [contents[i] for i in cluster_indices]

                topic_name = await _generate_topic_name(cluster_contents)
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

                # Set topic's UMAP position as centroid of member 2D coords
                cluster_2d = coords_2d[[i for i, l in enumerate(labels) if l == cluster_id]]
                topic_x = float(cluster_2d[:, 0].mean())
                topic_y = float(cluster_2d[:, 1].mean())

                # Store on topic — add graph_x/graph_y to Topic model too (see CHANGE 1 note)
                # For now, return as computed — graph API will compute this inline

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
            all_topics_res = await db.execute(
                select(Topic).where(Topic.user_id == user_id)
            )
            for topic in all_topics_res.scalars().all():
                if topic.cluster_id not in active_cluster_ids:
                    await db.delete(topic)

            await db.commit()
            logger.info("Clustering complete and committed.")

        except Exception as e:
            await db.rollback()
            logger.error(f"Clustering failed: {e}", exc_info=True)
            raise
```

**Add to `backend/requirements.txt`:**
```
umap-learn>=0.5.6
hdbscan>=0.8.33
```

---

### CHANGE 3 — Enrich Graph API with semantic links + UMAP coords

**File: `backend/routes/graph.py`** — full replacement

```python
from __future__ import annotations
"""Graph data endpoint — Obsidian-level knowledge graph with semantic edges."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Note, Topic, NoteLink, User
from middleware.auth import get_current_user, CurrentUser

router = APIRouter(prefix="/graph", tags=["graph"])

# Topic color palette — assigned by cluster_id index
TOPIC_COLORS = [
    "#7C3AED", "#2563EB", "#059669", "#D97706",
    "#DC2626", "#0891B2", "#65A30D", "#9333EA",
]


@router.get("/data")
async def get_graph_data(
    semantic_threshold: float = 0.75,
    max_semantic_per_note: int = 5,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Returns enriched graph payload:
    - Nodes: topics + notes with UMAP coords, degree, color index
    - Links: topic_link, semantic_link (pgvector), tag_link, backlink
    """

    # ── Fetch data ──────────────────────────────────────────────────
    topic_result = await db.execute(
        select(Topic).where(Topic.user_id == current_user.id)
    )
    topics = topic_result.scalars().all()

    note_result = await db.execute(
        select(Note).where(
            Note.is_processed == True,
            Note.user_id == current_user.id,
            Note.embedding.isnot(None),
        )
    )
    notes = note_result.scalars().all()

    backlink_result = await db.execute(
        select(NoteLink).where(
            NoteLink.source_id.in_([n.id for n in notes])
        )
    )
    backlinks = backlink_result.scalars().all()

    # ── Build topic color map ────────────────────────────────────────
    topic_color_map: dict[str, int] = {}
    topic_id_map: dict[str, str] = {}

    for idx, t in enumerate(topics):
        graph_id = f"topic-{t.id}"
        topic_id_map[str(t.id)] = graph_id
        topic_color_map[str(t.id)] = idx % len(TOPIC_COLORS)

    # ── Semantic links via pgvector ──────────────────────────────────
    semantic_links = []
    seen_semantic: set[tuple] = set()

    if len(notes) >= 2:
        for note in notes:
            if note.embedding is None:
                continue
            rows = await db.execute(
                text("""
                    SELECT id, 1 - (embedding <=> CAST(:emb AS vector)) AS similarity
                    FROM notes
                    WHERE user_id = :uid
                      AND id != :nid
                      AND is_processed = true
                      AND embedding IS NOT NULL
                    ORDER BY embedding <=> CAST(:emb AS vector)
                    LIMIT :k
                """),
                {
                    "emb": str(note.embedding),
                    "uid": str(current_user.id),
                    "nid": str(note.id),
                    "k": max_semantic_per_note,
                },
            )
            for row in rows:
                if float(row.similarity) >= semantic_threshold:
                    key = tuple(sorted([str(note.id), str(row.id)]))
                    if key not in seen_semantic:
                        semantic_links.append({
                            "source": f"note-{note.id}",
                            "target": f"note-{row.id}",
                            "type": "semantic_link",
                            "weight": round(float(row.similarity), 3),
                        })
                        seen_semantic.add(key)

    # ── Precompute degree map ────────────────────────────────────────
    degree_map: dict[str, int] = {}
    all_links_for_degree = (
        [{"source": f"topic-{t.id}", "target": f"note-{n.id}"}
         for n in notes if n.topic_id and str(n.topic_id) in topic_id_map
         for t in topics if str(t.id) == str(n.topic_id)]
        + semantic_links
    )
    for lnk in all_links_for_degree:
        s = lnk["source"] if isinstance(lnk["source"], str) else lnk["source"]["id"]
        t = lnk["target"] if isinstance(lnk["target"], str) else lnk["target"]["id"]
        degree_map[s] = degree_map.get(s, 0) + 1
        degree_map[t] = degree_map.get(t, 0) + 1

    # ── Build nodes ──────────────────────────────────────────────────
    nodes = []
    links = []
    tag_map: dict[str, list[str]] = {}

    # Topic nodes
    for t in topics:
        graph_id = f"topic-{t.id}"
        # Compute topic 2D center from its notes' graph coords
        member_notes = [n for n in notes if n.topic_id and str(n.topic_id) == str(t.id)]
        xs = [n.graph_x for n in member_notes if n.graph_x is not None]
        ys = [n.graph_y for n in member_notes if n.graph_y is not None]
        topic_x = sum(xs) / len(xs) if xs else None
        topic_y = sum(ys) / len(ys) if ys else None

        nodes.append({
            "id": graph_id,
            "label": t.name,
            "type": "topic",
            "count": t.note_count or 0,
            "color_index": topic_color_map.get(str(t.id), 0),
            "color": TOPIC_COLORS[topic_color_map.get(str(t.id), 0)],
            "graph_x": topic_x,
            "graph_y": topic_y,
            "degree": degree_map.get(graph_id, 0),
        })

    # Note nodes
    for n in notes:
        graph_id = f"note-{n.id}"
        all_tags = list(set((n.auto_tags or []) + (n.user_tags or []) + (n.tags or [])))

        topic_color_idx = topic_color_map.get(str(n.topic_id), 0) if n.topic_id else None

        nodes.append({
            "id": graph_id,
            "label": n.title or "Untitled",
            "type": "note",
            "topic_id": topic_id_map.get(str(n.topic_id)) if n.topic_id else None,
            "topic_color_index": topic_color_idx,
            "color": TOPIC_COLORS[topic_color_idx] if topic_color_idx is not None else "#4B5563",
            "tags": all_tags,
            "source_url": n.source_url,
            "graph_x": n.graph_x,
            "graph_y": n.graph_y,
            "degree": degree_map.get(graph_id, 0),
            "is_outlier": n.topic_id is None,  # HDBSCAN label=-1 notes
        })

        # topic → note link
        if n.topic_id and str(n.topic_id) in topic_id_map:
            links.append({
                "source": topic_id_map[str(n.topic_id)],
                "target": graph_id,
                "type": "topic_link",
            })

        for tag in all_tags:
            tag_map.setdefault(tag, []).append(graph_id)

    # Semantic links
    links.extend(semantic_links)

    # Tag links
    seen_tag: set[tuple] = set()
    for tag, note_ids in tag_map.items():
        for i in range(len(note_ids)):
            for j in range(i + 1, len(note_ids)):
                key = tuple(sorted([note_ids[i], note_ids[j]]))
                if key not in seen_tag:
                    links.append({
                        "source": note_ids[i],
                        "target": note_ids[j],
                        "type": "tag_link",
                        "shared_tag": tag,
                    })
                    seen_tag.add(key)

    # Backlinks (from NoteLink model)
    note_graph_ids = {str(n.id): f"note-{n.id}" for n in notes}
    for bl in backlinks:
        src = note_graph_ids.get(str(bl.source_id))
        tgt = note_graph_ids.get(str(bl.target_id))
        if src and tgt:
            links.append({
                "source": src,
                "target": tgt,
                "type": "backlink",
                "weight": round(bl.similarity_score, 3),
            })

    return {
        "nodes": nodes,
        "links": links,
        "meta": {
            "total_notes": len(notes),
            "total_topics": len(topics),
            "semantic_links": len(semantic_links),
            "semantic_threshold": semantic_threshold,
        },
    }
```

---

### CHANGE 4 — Replace `GraphView.jsx` with Obsidian-level renderer

**File: `frontend/src/components/GraphView.jsx`** — full replacement

```jsx
import ForceGraph2D from "react-force-graph-2d";
import { useRef, useState, useCallback, useEffect, useMemo } from "react";

/**
 * Obsidian-level knowledge graph.
 *
 * Features:
 * - Node size scales with connection degree
 * - Per-topic color coding (notes inherit topic color)
 * - Edge types: topic_link (purple), semantic_link (blue), tag_link (gray), backlink (green)
 * - Local graph mode: click node → show N-hop neighborhood only
 * - UMAP 2D coords used as initial positions
 * - Outlier notes (no topic) rendered as dimmed gray
 */
export default function GraphView({
    data,
    onNodeClick,
    localMode = false,
    localDepth = 2,
    showEdgeTypes = { topic_link: true, semantic_link: true, tag_link: false, backlink: true },
}) {
    const graphRef = useRef();
    const [hoveredNode, setHoveredNode] = useState(null);
    const [focusNode, setFocusNode] = useState(null);  // local graph center
    const [hlNodes, setHlNodes] = useState(new Set());
    const [hlLinks, setHlLinks] = useState(new Set());

    // ── Filter data by edge type visibility ──────────────────────────
    const filteredData = useMemo(() => {
        const visibleLinks = data.links.filter(l => showEdgeTypes[l.type] !== false);
        const visibleNodeIds = new Set(data.nodes.map(n => n.id));
        return { nodes: data.nodes, links: visibleLinks };
    }, [data, showEdgeTypes]);

    // ── Local graph: N-hop neighborhood of focusNode ─────────────────
    const localData = useMemo(() => {
        if (!focusNode) return filteredData;

        let frontier = new Set([focusNode.id]);
        let visited = new Set([focusNode.id]);

        for (let depth = 0; depth < localDepth; depth++) {
            const next = new Set();
            filteredData.links.forEach(l => {
                const s = l.source?.id ?? l.source;
                const t = l.target?.id ?? l.target;
                if (frontier.has(s)) next.add(t);
                if (frontier.has(t)) next.add(s);
            });
            next.forEach(n => visited.add(n));
            frontier = next;
        }

        const visibleNodes = filteredData.nodes.filter(n => visited.has(n.id));
        const visibleLinks = filteredData.links.filter(l => {
            const s = l.source?.id ?? l.source;
            const t = l.target?.id ?? l.target;
            return visited.has(s) && visited.has(t);
        });

        return { nodes: visibleNodes, links: visibleLinks };
    }, [focusNode, filteredData, localDepth]);

    // ── Adjacency for hover highlight ────────────────────────────────
    const connectedSet = useCallback((node) => {
        const ids = new Set([node.id]);
        const ls = new Set();
        localData.links.forEach(l => {
            const s = l.source?.id ?? l.source;
            const t = l.target?.id ?? l.target;
            if (s === node.id) { ids.add(t); ls.add(l); }
            if (t === node.id) { ids.add(s); ls.add(l); }
        });
        return { ids, ls };
    }, [localData.links]);

    const handleNodeHover = useCallback((node) => {
        if (node) {
            const { ids, ls } = connectedSet(node);
            setHlNodes(ids);
            setHlLinks(ls);
        } else {
            setHlNodes(new Set());
            setHlLinks(new Set());
        }
        setHoveredNode(node || null);
    }, [connectedSet]);

    const handleNodeClick = useCallback((node) => {
        // Toggle local graph focus
        if (focusNode?.id === node.id) {
            setFocusNode(null);
        } else {
            setFocusNode(node);
            if (graphRef.current) {
                graphRef.current.centerAt(node.x, node.y, 600);
                graphRef.current.zoom(3.5, 700);
            }
        }
        onNodeClick?.(node);
    }, [focusNode, onNodeClick]);

    const handleNodeDblClick = useCallback((node) => {
        if (node.type === "note") {
            window.open(`/note/${node.id.replace("note-", "")}`, "_blank");
        }
    }, []);

    // ── Seed initial positions from UMAP coords ──────────────────────
    // Scale UMAP space (approx -5..5) to canvas space
    const UMAP_SCALE = 180;
    const seededNodes = useMemo(() => {
        return localData.nodes.map(n => ({
            ...n,
            x: n.graph_x != null ? n.graph_x * UMAP_SCALE : n.x,
            y: n.graph_y != null ? n.graph_y * UMAP_SCALE : n.y,
        }));
    }, [localData.nodes]);

    // ── Node painter ─────────────────────────────────────────────────
    const paintNode = useCallback((node, ctx, globalScale) => {
        const isTopic = node.type === "topic";
        const isHovered = hoveredNode?.id === node.id;
        const isFocused = focusNode?.id === node.id;
        const isHighlighted = hlNodes.has(node.id);
        const isDimmed = hlNodes.size > 0 && !isHighlighted;
        const isOutlier = node.is_outlier;

        // Size: topics by note_count, notes by degree
        const degree = node.degree || 0;
        const size = isTopic
            ? Math.max(12, Math.min(28, (node.count || 1) * 2.5 + 10))
            : Math.max(3.5, Math.min(11, degree * 1.8 + 3.5));

        // Color
        let baseColor = node.color || (isTopic ? "#7C3AED" : "#4B5563");
        if (isOutlier) baseColor = "#374151";

        const alpha = isDimmed ? 0.15 : 1.0;
        ctx.globalAlpha = alpha;

        // Glow for highlighted / focused
        if ((isHighlighted || isFocused) && !isDimmed) {
            ctx.shadowColor = isTopic ? baseColor : "#A78BFA";
            ctx.shadowBlur = isTopic ? 18 : 10;
        } else {
            ctx.shadowBlur = 0;
        }

        // Draw circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);

        if (isTopic) {
            // Radial gradient for topic nodes
            const gradient = ctx.createRadialGradient(
                node.x - size * 0.3, node.y - size * 0.3, 0,
                node.x, node.y, size
            );
            gradient.addColorStop(0, lighten(baseColor, 0.3));
            gradient.addColorStop(1, baseColor);
            ctx.fillStyle = gradient;
        } else {
            ctx.fillStyle = isHovered ? "#F9FAFB" : (isHighlighted ? lighten(baseColor, 0.4) : baseColor);
        }
        ctx.fill();

        // Ring for selected focus node
        if (isFocused) {
            ctx.strokeStyle = "#FFFFFF";
            ctx.lineWidth = 1.5 / globalScale;
            ctx.stroke();
        }

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1.0;

        // Label
        const showLabel = isTopic || isHighlighted || isHovered || globalScale > 2.5;
        if (showLabel && !isDimmed) {
            const fontSize = isTopic
                ? Math.max(10, 13 / globalScale)
                : Math.max(8, 10 / globalScale);
            ctx.font = `${isTopic ? 600 : 400} ${fontSize}px Inter, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = isTopic ? "#E9D5FF" : "#D1D5DB";
            ctx.globalAlpha = isDimmed ? 0.1 : (isHighlighted ? 1 : 0.85);
            const label = node.label?.length > 28 ? node.label.slice(0, 26) + "…" : (node.label || "");
            ctx.fillText(label, node.x, node.y + size + 3);
            ctx.globalAlpha = 1.0;
        }
    }, [hoveredNode, focusNode, hlNodes]);

    // ── Link painter ─────────────────────────────────────────────────
    const paintLink = useCallback((link, ctx) => {
        const isHl = hlLinks.has(link);
        const type = link.type;

        const styles = {
            topic_link:    { color: "#7C3AED", width: 1.2, opacity: 0.5 },
            semantic_link: { color: "#3B82F6", width: (link.weight || 0.75) * 2, opacity: 0.45 },
            tag_link:      { color: "#374151", width: 0.5, opacity: 0.2 },
            backlink:      { color: "#10B981", width: 1.2, opacity: 0.65 },
        };
        const s = styles[type] ?? { color: "#4B5563", width: 0.7, opacity: 0.25 };

        ctx.globalAlpha = isHl ? Math.min(s.opacity * 2, 1) : s.opacity;
        ctx.strokeStyle = isHl ? lighten(s.color, 0.4) : s.color;
        ctx.lineWidth = isHl ? s.width * 2 : s.width;

        // Dashed for tag links
        if (type === "tag_link") {
            ctx.setLineDash([2, 4]);
        } else {
            ctx.setLineDash([]);
        }
    }, [hlLinks]);

    return (
        <div style={{ width: "100%", height: "100%", background: "#030712", borderRadius: 16, overflow: "hidden", position: "relative" }}>
            {/* Focus indicator */}
            {focusNode && (
                <div style={{
                    position: "absolute", bottom: 60, left: "50%", transform: "translateX(-50%)",
                    zIndex: 30, background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.4)",
                    borderRadius: 20, padding: "6px 16px", fontSize: 12, color: "#A78BFA",
                    backdropFilter: "blur(8px)", pointerEvents: "none",
                }}>
                    🔍 Local view · {focusNode.label?.slice(0, 30)} · click again to exit
                </div>
            )}

            <ForceGraph2D
                ref={graphRef}
                graphData={{ nodes: seededNodes, links: localData.links }}
                nodeCanvasObject={paintNode}
                nodeCanvasObjectMode={() => "replace"}
                linkCanvasObjectMode={() => "after"}
                linkCanvasObject={paintLink}
                onNodeHover={handleNodeHover}
                onNodeClick={handleNodeClick}
                onNodeRightClick={handleNodeDblClick}
                // Directional particles on highlighted edges
                linkDirectionalParticles={link => (hlLinks.has(link) ? 3 : 0)}
                linkDirectionalParticleSpeed={0.004}
                linkDirectionalParticleWidth={2}
                linkDirectionalParticleColor={link => link.type === "semantic_link" ? "#60A5FA" : "#A78BFA"}
                backgroundColor="#030712"
                cooldownTicks={200}
                d3AlphaDecay={0.015}
                d3VelocityDecay={0.3}
                // Stronger repulsion for more spread
                d3Force="charge"
                nodeRelSize={1}
            />
        </div>
    );
}

// ── Color utilities ────────────────────────────────────────────────────────
function lighten(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, (num >> 16) + Math.round(255 * amount));
    const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amount));
    const b = Math.min(255, (num & 0xff) + Math.round(255 * amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
```

---

### CHANGE 5 — Update `TopicsPage.jsx` with new controls

**File: `frontend/src/pages/TopicsPage.jsx`** — add these controls above the existing GraphView render:

Add new state variables:
```jsx
const [localMode, setLocalMode] = useState(false);
const [localDepth, setLocalDepth] = useState(2);
const [showEdgeTypes, setShowEdgeTypes] = useState({
    topic_link: true,
    semantic_link: true,
    tag_link: false,
    backlink: true,
});
const [semanticThreshold, setSemanticThreshold] = useState(75);
```

Replace the `<GraphView data={filteredData} onNodeClick={handleNodeClick} />` line with:
```jsx
<GraphView
    data={filteredData}
    onNodeClick={handleNodeClick}
    localMode={localMode}
    localDepth={localDepth}
    showEdgeTypes={showEdgeTypes}
/>
```

Add a legend/controls panel (bottom-left, above existing legend):
```jsx
{/* Edge type toggles */}
<div style={{
    position: "absolute", bottom: 16, left: 16, zIndex: 20,
    background: "rgba(17,24,39,0.92)", border: "1px solid #1F2937",
    borderRadius: 12, padding: "14px 16px", fontSize: 12, color: "#6B7280",
    display: "flex", flexDirection: "column", gap: 10,
    backdropFilter: "blur(8px)", minWidth: 200,
}}>
    <div style={{ color: "#9CA3AF", fontWeight: 600, marginBottom: 2 }}>Edge Types</div>

    {[
        { key: "topic_link",    color: "#7C3AED", label: "Topic clusters" },
        { key: "semantic_link", color: "#3B82F6", label: "Semantic similarity" },
        { key: "tag_link",      color: "#374151", label: "Shared tags" },
        { key: "backlink",      color: "#10B981", label: "Backlinks" },
    ].map(({ key, color, label }) => (
        <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
                type="checkbox"
                checked={showEdgeTypes[key] !== false}
                onChange={e => setShowEdgeTypes(prev => ({ ...prev, [key]: e.target.checked }))}
                style={{ accentColor: color }}
            />
            <span style={{ width: 12, height: 2, background: color, display: "inline-block", borderRadius: 1 }} />
            <span>{label}</span>
        </label>
    ))}

    <div style={{ borderTop: "1px solid #1F2937", paddingTop: 8, marginTop: 2 }}>
        <div style={{ color: "#9CA3AF", fontWeight: 600, marginBottom: 6 }}>
            Semantic threshold: {semanticThreshold}%
        </div>
        <input
            type="range" min={60} max={95} value={semanticThreshold}
            onChange={e => setSemanticThreshold(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#3B82F6" }}
        />
    </div>

    <div style={{ borderTop: "1px solid #1F2937", paddingTop: 8, marginTop: 2 }}>
        <div style={{ color: "#9CA3AF", fontWeight: 600, marginBottom: 6 }}>Local graph depth</div>
        <div style={{ display: "flex", gap: 6 }}>
            {[1, 2, 3].map(d => (
                <button key={d} onClick={() => setLocalDepth(d)} style={{
                    padding: "4px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                    background: localDepth === d ? "rgba(124,58,237,0.3)" : "transparent",
                    border: `1px solid ${localDepth === d ? "rgba(124,58,237,0.6)" : "#374151"}`,
                    color: localDepth === d ? "#A78BFA" : "#6B7280",
                }}>
                    {d}
                </button>
            ))}
        </div>
    </div>
</div>
```

Also update `loadGraph()` to pass the semantic threshold as a query param:
```jsx
const res = await api.get(`/graph/data?semantic_threshold=${semanticThreshold / 100}`);
```

And add a `useEffect` to reload when threshold changes (debounced):
```jsx
useEffect(() => {
    const timer = setTimeout(() => loadGraph(), 600);
    return () => clearTimeout(timer);
}, [semanticThreshold]);
```

---

## TESTING CHECKLIST

After making all changes, verify:

- [ ] `pip install umap-learn hdbscan` installs cleanly in the Docker backend container
- [ ] `POST /api/topics/recluster` runs without error and returns 200
- [ ] `GET /api/graph/data` returns nodes with `graph_x`, `graph_y`, `color`, `degree` fields
- [ ] `GET /api/graph/data` returns `semantic_link` type edges in the links array
- [ ] Frontend graph shows note nodes with different sizes (degree-based)
- [ ] Notes that belong to the same topic share the same color as their topic node
- [ ] Clicking a note node switches to local graph showing only its neighbors
- [ ] Clicking the same note again returns to global graph
- [ ] Edge type checkboxes correctly show/hide edge categories
- [ ] Depth buttons (1/2/3) change the neighborhood size in local mode
- [ ] Semantic threshold slider correctly reloads with fewer/more edges

---

## NOTES & EDGE CASES

1. **Cold start (< 5 notes):** Clustering falls back gracefully — no UMAP, just assigns all to cluster 0
2. **UMAP install size:** `umap-learn` adds ~150MB to the Docker image. If Dockerfile uses a slim base, ensure `python3-dev` and `liblapack-dev` are present for numpy compilation
3. **Render free tier timeout:** The semantic link query runs per-note. For large vaults (100+ notes), consider adding a `LIMIT 50` on notes in the semantic query or precomputing NoteLink rows during note save
4. **The `NoteLink` table is already populated** by the existing note processing pipeline with backlink similarity scores — no additional backfill needed
5. **Alembic:** If the project uses Alembic, generate the migration for `graph_x`/`graph_y` properly. If not, the raw SQL in `add_graph_coords.sql` applies via `init_db()`'s `CREATE TABLE IF NOT EXISTS` approach — add `text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS graph_x FLOAT")` calls to `init_db()` in `database.py`

---

*Prompt version: 1.0 | Target: MindVault v1.0 | Scope: backend/services/clustering.py, backend/routes/graph.py, backend/models.py, frontend/src/components/GraphView.jsx, frontend/src/pages/TopicsPage.jsx*
