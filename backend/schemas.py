from __future__ import annotations
"""Pydantic schemas for API request/response models."""

from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field


# ─── Note Schemas ───────────────────────────────────────────────

class NoteCreate(BaseModel):
    title: str = Field(..., max_length=500)
    content: str
    source_url: str | None = None
    tags: list[str] | None = []
    annotation: str | None = None


class NoteYoutubeCreate(BaseModel):
    video_url: str = Field(..., description="The URL of the YouTube video")
    annotation: str | None = None


class NoteLinkOut(BaseModel):
    id: UUID
    note_id: UUID
    title: str
    similarity_score: float

    model_config = {"from_attributes": True}


class NoteOut(BaseModel):
    id: UUID
    title: str
    content: str
    source_url: str | None = None
    tags: list[str] | None = []
    summary: str | None = None
    key_concepts: list[str] | None = None
    topic_id: UUID | None = None
    topic_name: str | None = None
    is_processed: bool = False
    created_at: datetime
    updated_at: datetime
    backlinks: list[NoteLinkOut] = []

    model_config = {"from_attributes": True}


class NoteListOut(BaseModel):
    id: UUID
    title: str
    summary: str | None = None
    tags: list[str] | None = []
    topic_id: UUID | None = None
    topic_name: str | None = None
    source_url: str | None = None
    is_processed: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Topic Schemas ──────────────────────────────────────────────

class TopicOut(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    note_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Search Schemas ─────────────────────────────────────────────

class SearchResult(BaseModel):
    note: NoteListOut
    similarity: float


class RAGResponse(BaseModel):
    answer: str
    sources: list[SearchResult]


class SearchResponse(BaseModel):
    results: list[SearchResult]
    rag: RAGResponse | None = None


# ─── Related Notes ──────────────────────────────────────────────

class RelatedNotesResponse(BaseModel):
    notes: list[SearchResult]
