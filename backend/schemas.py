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
    user_tags: list[str] = []
    annotation: str | None = None


class NoteYoutubeCreate(BaseModel):
    video_url: str = Field(..., description="The URL of the YouTube video")
    annotation: str | None = None
    transcript: str | None = Field(None, description="Pre-fetched transcript text (client-side extraction)")
    title: str | None = Field(None, description="Video title from client")


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
    auto_tags: list[str] = []
    user_tags: list[str] = []
    summary: str | None = None
    key_concepts: list[str] | None = None
    topic_id: UUID | None = None
    topic_name: str | None = None
    language: str = "en"
    is_processed: bool = False
    processed: bool = False
    created_at: datetime
    updated_at: datetime
    backlinks: list[NoteLinkOut] = []

    model_config = {"from_attributes": True}


class NoteListOut(BaseModel):
    id: UUID
    title: str
    summary: str | None = None
    tags: list[str] | None = []
    auto_tags: list[str] = []
    user_tags: list[str] = []
    topic_id: UUID | None = None
    topic_name: str | None = None
    source_url: str | None = None
    language: str = "en"
    is_processed: bool = False
    processed: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Topic Schemas ──────────────────────────────────────────────

class TopicOut(BaseModel):
    id: UUID
    name: str
    cluster_id: int | None = None
    description: str | None = None
    note_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class TagUpdate(BaseModel):
    tags: list[str]

class SuggestTagsResponse(BaseModel):
    suggested_tags: list[str]


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
    query_language: str = "en"


# ─── Related Notes ──────────────────────────────────────────────

class RelatedNotesResponse(BaseModel):
    notes: list[SearchResult]
