from __future__ import annotations
"""RAG Agent — simplified search→synthesize pipeline (1 LLM call)."""

import uuid
import json
from typing import TypedDict
from sqlalchemy import text
from langgraph.graph import StateGraph, END

from database import async_session
from models import Topic
from schemas import SearchResult, NoteListOut
from services.embedding import get_embedding
from services.llm import llm_complete
from services.language import detect_language, is_indic
from langsmith import traceable


# ─── State ──────────────────────────────────────────────────────

class AgentState(TypedDict):
    query: str
    retrieved_notes: list[SearchResult]
    final_answer: str
    sources: list[SearchResult]
    user_id: str  # UUID string for per-user scoping


# ─── Nodes ──────────────────────────────────────────────────────

@traceable(name="agent_search_node", tags=["agent", "retrieval"])
async def search_node(state: AgentState) -> dict:
    """Retrieve top-5 relevant notes from pgvector via the current query.
    
    SECURITY: user_id is REQUIRED. Search is always scoped to a single user.
    Raises ValueError if user_id is missing or empty — never falls back to
    a global unscoped query.
    """
    user_id = state.get("user_id")
    if not user_id:
        raise ValueError(
            "search_node requires a non-empty user_id in AgentState. "
            "Unscoped global note search is not permitted."
        )

    query_embedding = await get_embedding(state["query"])
    search_results = []

    async with async_session() as db:
        result = await db.execute(
            text("""
                SELECT id, title, summary, tags, topic_id, source_url, is_processed, created_at,
                       1 - (embedding <=> CAST(:emb AS vector)) as similarity
                FROM notes
                WHERE embedding IS NOT NULL
                  AND user_id = CAST(:uid AS uuid)
                ORDER BY embedding <=> CAST(:emb AS vector)
                LIMIT :top_k
            """),
            {"emb": str(query_embedding), "top_k": 5, "uid": user_id},
        )
        rows = result.all()

        for row in rows:
            note_id, title, summary, tags, topic_id, source_url, is_processed, created_at, similarity = row

            topic_name = None
            if topic_id:
                topic = await db.get(Topic, topic_id)
                if topic:
                    topic_name = topic.name

            search_results.append(SearchResult(
                note=NoteListOut(
                    id=note_id,
                    title=title,
                    summary=summary,
                    tags=tags or [],
                    topic_id=topic_id,
                    topic_name=topic_name,
                    source_url=source_url,
                    is_processed=is_processed,
                    created_at=created_at,
                ),
                similarity=round(float(similarity), 4),
            ))

    return {"retrieved_notes": search_results}


@traceable(name="agent_synthesize_node", tags=["agent", "synthesis"])
async def synthesize_node(state: AgentState) -> dict:
    """Generate final answer from retrieved notes."""
    query = state["query"]
    notes = state["retrieved_notes"]
    query_lang = detect_language(query)

    if not notes:
        return {
            "final_answer": "I couldn't find any relevant notes in your vault for this query.",
            "sources": [],
        }

    context_block = "\n\n---\n\n".join(
        f"[Source {i+1}]: Title: {n.note.title}\n{n.note.summary or ''}"
        for i, n in enumerate(notes)
    )

    prompt = f"""<role>You are MindVault's answer synthesis engine. You answer using ONLY the user's personal notes.</role>

<task>Answer the question. Return a structured JSON response.</task>

<notes>
{context_block}
</notes>

<question>{query}</question>

<schema>
{{
  "answer": "2-4 sentences, natural prose, same language as question",
  "cited_source_ids": [1, 2],
  "confidence": "high | medium | low",
  "insufficient_context": true | false
}}
</schema>

<rules>
- cited_source_ids: integers referencing [Source N] numbers above
- Never invent details not in the notes
- If insufficient, set insufficient_context: true and say what's missing in answer
- Return ONLY the JSON object
</rules>

Output:"""

    raw = await llm_complete(prompt, query_lang)
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1])
        parsed = json.loads(cleaned)
        answer = parsed.get("answer", raw)
    except (json.JSONDecodeError, ValueError):
        answer = raw  # graceful fallback to raw string

    return {"final_answer": answer, "sources": notes}


# ─── Graph Compilation ──────────────────────────────────────────

workflow = StateGraph(AgentState)

workflow.add_node("search", search_node)
workflow.add_node("synthesize", synthesize_node)

workflow.set_entry_point("search")
workflow.add_edge("search", "synthesize")
workflow.add_edge("synthesize", END)

rag_agent = workflow.compile()
