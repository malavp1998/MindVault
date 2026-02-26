from __future__ import annotations
"""Graph data endpoint — returns all topics and notes as a knowledge graph."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Note, Topic

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("/data")
async def get_graph_data(db: AsyncSession = Depends(get_db)):
    """
    Returns a force-graph compatible payload of all topics and notes.
    Notes are linked to their topic, and notes sharing tags are cross-linked.
    """
    # 1. Fetch all topics
    topic_result = await db.execute(select(Topic))
    topics = topic_result.scalars().all()

    # 2. Fetch all processed notes that have been assigned a topic or have tags
    note_result = await db.execute(
        select(Note).where(Note.is_processed == True)  # noqa: E712
    )
    notes = note_result.scalars().all()

    nodes = []
    links = []

    # 3. Build topic nodes (large)
    topic_id_map: dict[str, str] = {}  # DB uuid -> graph id
    for t in topics:
        graph_id = f"topic-{t.id}"
        topic_id_map[str(t.id)] = graph_id
        nodes.append({
            "id": graph_id,
            "label": t.name,
            "type": "topic",
            "count": t.note_count or 0,
        })

    # 4. Build note nodes (small) and topic→note links
    tag_map: dict[str, list[str]] = {}  # tag -> [graph_note_ids]

    for n in notes:
        graph_id = f"note-{n.id}"
        all_tags = list(set(
            (n.auto_tags or []) + (n.user_tags or []) + (n.tags or [])
        ))
        nodes.append({
            "id": graph_id,
            "label": n.title or "Untitled",
            "type": "note",
            "topic_id": topic_id_map.get(str(n.topic_id)) if n.topic_id else None,
            "tags": all_tags,
            "source_url": n.source_url,
        })

        # link note -> topic
        if n.topic_id and str(n.topic_id) in topic_id_map:
            links.append({
                "source": topic_id_map[str(n.topic_id)],
                "target": graph_id,
                "type": "topic_link",
            })

        # build tag map for cross-linking
        for tag in all_tags:
            tag_map.setdefault(tag, []).append(graph_id)

    # 5. Cross-link notes that share tags (knowledge connections)
    seen_links: set[tuple[str, str]] = set()
    for tag, note_ids in tag_map.items():
        for i in range(len(note_ids)):
            for j in range(i + 1, len(note_ids)):
                key = tuple(sorted([note_ids[i], note_ids[j]]))
                if key not in seen_links:
                    links.append({
                        "source": note_ids[i],
                        "target": note_ids[j],
                        "shared_tag": tag,
                        "type": "tag_link",
                    })
                    seen_links.add(key)

    return {"nodes": nodes, "links": links}
