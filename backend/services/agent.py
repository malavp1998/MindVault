from __future__ import annotations
import json
import uuid
from typing import TypedDict, Literal
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from langgraph.graph import StateGraph, END
from pydantic import BaseModel, Field

from database import async_session
from models import Topic
from schemas import SearchResult, NoteListOut
from services.embedding import get_embedding
from services.llm import llm_complete
from services.language import detect_language, is_indic


# ─── State & Schemas ────────────────────────────────────────────

class AgentState(TypedDict):
    """The graph state for the search reasoning pipeline."""
    query: str
    rewritten_query: str
    retrieved_notes: list[SearchResult]
    relevance_score: float
    final_answer: str
    sources: list[SearchResult]
    retry_count: int
    user_id: str  # UUID string for per-user scoping


class RouteDecision(BaseModel):
    category: Literal["specific_note", "topic_summary", "broad_search"] = Field(
        description="The category of the user query."
    )


class GraderDecision(BaseModel):
    score: float = Field(
        description="Relevance score between 0.0 and 1.0. 1.0 means highly relevant.",
        ge=0.0,
        le=1.0,
    )
    feedback: str = Field(
        description="Brief feedback on why the notes are or are not relevant."
    )
    improved_query: str | None = Field(
        None, description="If score < 0.7, provide an improved search query to try again."
    )


# ─── Nodes ──────────────────────────────────────────────────────

async def route_node(state: AgentState) -> dict:
    """Classify the user's query intent."""
    query = state["query"]
    prompt = (
        "You are an expert query router. Classify the user's query into one of three categories:\n"
        "1. specific_note: looking for a specific saved fact or URL.\n"
        "2. topic_summary: asking for a summary of a broad topic.\n"
        "3. broad_search: a general exploratory search.\n"
        "Respond ONLY with a JSON object like: {\"category\": \"specific_note\"}"
    )
    result = await llm_complete(f"{prompt}\n\nQuery: {query}")
    try:
        # Try finding JSON block
        cleaned = result.strip()
        if cleaned.startswith("```"):
            cleaned = "\n".join(cleaned.split("\n")[1:-1])
        data = json.loads(cleaned)
        # We don't necessarily change state based on route yet, but we could use it in the prompt.
        # For now we'll just log it.
        print(f"Route parsed: {data.get('category')}")
    except Exception:
        pass
    
    # Initialize rewritten_query and retry_count if not set
    return {
        "rewritten_query": state.get("rewritten_query", query),
        "retry_count": state.get("retry_count", 0),
        "retrieved_notes": [],
        "sources": []
    }


async def search_node(state: AgentState) -> dict:
    """Retrieve top-5 relevant notes from pgvector via the current query."""
    query_to_search = state.get("rewritten_query") or state["query"]
    
    query_embedding = await get_embedding(query_to_search)

    search_results = []
    user_id = state.get("user_id")
    
    # Open a short-lived session since nodes aren't currently passed the FastAPI request DB session.
    async with async_session() as db:
        # Build query with user scoping if user_id is available
        if user_id:
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
        else:
            result = await db.execute(
                text("""
                    SELECT id, title, summary, tags, topic_id, source_url, is_processed, created_at,
                           1 - (embedding <=> CAST(:emb AS vector)) as similarity
                    FROM notes
                    WHERE embedding IS NOT NULL
                    ORDER BY embedding <=> CAST(:emb AS vector)
                    LIMIT :top_k
                """),
                {"emb": str(query_embedding), "top_k": 5},
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


async def grade_node(state: AgentState) -> dict:
    """Evaluate if retrieved notes actually address the user's query."""
    query = state["query"]
    notes = state["retrieved_notes"]
    
    if not notes:
        return {"relevance_score": 0.0, "rewritten_query": query}

    context_str = "\n---\n".join(
        f"Title: {n.note.title}\nContent Snippet: {n.note.summary or ''}" for n in notes
    )
    
    prompt = (
        "You are an expert grader evaluating search relevance. "
        "Given the user's query and a set of retrieved notes, score how relevant the notes are "
        "to answering the query on a scale of 0.0 to 1.0.\n"
        "If the score is less than 0.7, provide an 'improved_query' that might yield better vector search results.\n"
        "Respond ONLY with a JSON object like:\n"
        "{\"score\": 0.8, \"feedback\": \"...\", \"improved_query\": \"...\"}"
    )
    
    result = await llm_complete(f"{prompt}\n\nQuery: {query}\n\nRetrieved Notes:\n{context_str}")
    
    try:
        cleaned = result.strip()
        if cleaned.startswith("```"):
            cleaned = "\n".join(cleaned.split("\n")[1:-1])
        data = json.loads(cleaned)
        score = float(data.get("score", 0.0))
        improved = data.get("improved_query")
    except Exception:
        score = 1.0 # default to pass if LLM fails parsing
        improved = None
        
    return {
        "relevance_score": score,
        "rewritten_query": improved if improved else query,
    }


def decide_to_retry(state: AgentState) -> str:
    """Conditional edge router after grading."""
    score = state.get("relevance_score", 0.0)
    retries = state.get("retry_count", 0)
    
    if score >= 0.7 or retries >= 2:
        return "good"
    else:
        # Only increment retry if we loop back
        state["retry_count"] = retries + 1
        return "retry"


async def synthesize_node(state: AgentState) -> dict:
    """Generate final answer from retrieved notes using the native language."""
    query = state["query"]
    notes = state["retrieved_notes"]
    query_lang = detect_language(query)
    
    if not notes:
        answer = "I couldn't find any relevant notes in your vault for this query."
        return {"final_answer": answer, "sources": []}
    
    context_block = "\n\n---\n\n".join(
        f"[Source {i+1}]: Title: {n.note.title}\n{n.note.summary or ''}" 
        for i, n in enumerate(notes)
    )
    
    if is_indic(query_lang):
        prompt = f"""
        Aap ek helpful assistant ho. Neeche diye gaye notes ke basis par 
        question ka jawab do. Sirf notes ki information use karo.
        Answer {query_lang} language mein do.
        
        Notes:
        {context_block}
        
        Question: {query}
        """
    else:
        prompt = f"""
        You are a knowledgeable assistant answering questions based strictly on the user's personal notes. 
        Use the provided source notes below to accurately answer the question. 
        Cite your sources using [Source N] notation. If the sources don't contain enough information, 
        state exactly what you know and don't invent details.
        
        Notes:
        {context_block}
        
        Question: {query}
        """
    
    answer = await llm_complete(prompt, query_lang)
    
    return {"final_answer": answer, "sources": notes}


# ─── Graph Compilation ──────────────────────────────────────────

workflow = StateGraph(AgentState)

workflow.add_node("route", route_node)
workflow.add_node("search", search_node)
workflow.add_node("grade", grade_node)
workflow.add_node("synthesize", synthesize_node)

workflow.set_entry_point("route")
workflow.add_edge("route", "search")
workflow.add_edge("search", "grade")
workflow.add_conditional_edges("grade", decide_to_retry, {
    "retry": "search",
    "good": "synthesize"
})
workflow.add_edge("synthesize", END)

rag_agent = workflow.compile()
