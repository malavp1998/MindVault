from __future__ import annotations
"""Graph data endpoint — Obsidian-level knowledge graph with semantic edges."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Note, Topic, User
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
                    "emb": "[" + ",".join(str(x) for x in note.embedding) + "]",
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

    # Semantic links
    links.extend(semantic_links)



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
