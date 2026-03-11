from __future__ import annotations
"""SQLAlchemy models for MindVault."""

import uuid
from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy import String, Text, DateTime, Date, Float, ForeignKey, Integer, JSON, Boolean, VARCHAR, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from pgvector.sqlalchemy import Vector
from database import Base


# ─── Auth Models ────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    username: Mapped[Optional[str]] = mapped_column(
        VARCHAR(50), unique=True, nullable=True
    )
    email: Mapped[Optional[str]] = mapped_column(
        VARCHAR(255), unique=True, nullable=True
    )
    hashed_password: Mapped[Optional[str]] = mapped_column(
        VARCHAR(255), nullable=True
    )
    firebase_uid: Mapped[Optional[str]] = mapped_column(
        VARCHAR(128), unique=True, nullable=True, index=True
    )
    phone_number: Mapped[Optional[str]] = mapped_column(
        VARCHAR(15), unique=True, nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    last_login: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    notes: Mapped[List["Note"]] = relationship("Note", back_populates="owner", cascade="all, delete-orphan")
    topics: Mapped[List["Topic"]] = relationship("Topic", back_populates="owner", cascade="all, delete-orphan")
    chat_sessions: Mapped[List["ChatSession"]] = relationship("ChatSession", back_populates="owner", cascade="all, delete-orphan")


class OTPVerification(Base):
    __tablename__ = "otp_verifications"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    phone_number: Mapped[str] = mapped_column(VARCHAR(15), nullable=False)
    otp_code: Mapped[str] = mapped_column(VARCHAR(6), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    is_used: Mapped[bool] = mapped_column(Boolean, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


# ─── Knowledge Models ──────────────────────────────────────────

class Note(Base):
    __tablename__ = "notes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    tags: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=list) # Legacy, optionally remove later
    auto_tags: Mapped[List[str]] = mapped_column(ARRAY(String), server_default="{}")
    user_tags: Mapped[List[str]] = mapped_column(ARRAY(String), server_default="{}")
    processed: Mapped[bool] = mapped_column(Boolean, server_default="false")
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    key_concepts: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    language: Mapped[str] = mapped_column(String(10), default="en")
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    topic_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("topics.id"), nullable=True
    )
    embedding = mapped_column(Vector(1536), nullable=True)
    is_processed: Mapped[bool] = mapped_column(default=False)
    graph_x: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    graph_y: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    owner: Mapped[Optional["User"]] = relationship("User", back_populates="notes")
    topic: Mapped[Optional["Topic"]] = relationship("Topic", back_populates="notes")
    outgoing_links: Mapped[List["NoteLink"]] = relationship(
        "NoteLink", foreign_keys="NoteLink.source_id", back_populates="source", cascade="all, delete-orphan"
    )
    incoming_links: Mapped[List["NoteLink"]] = relationship(
        "NoteLink", foreign_keys="NoteLink.target_id", back_populates="target", cascade="all, delete-orphan"
    )


class Topic(Base):
    __tablename__ = "topics"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    cluster_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    centroid = mapped_column(Vector(1536), nullable=True)
    note_count: Mapped[int] = mapped_column(Integer, default=0)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    owner: Mapped[Optional["User"]] = relationship("User", back_populates="topics")
    notes: Mapped[List["Note"]] = relationship("Note", back_populates="topic")


class NoteLink(Base):
    __tablename__ = "note_links"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False
    )
    similarity_score: Mapped[float] = mapped_column(Float, nullable=False)

    # Relationships
    source: Mapped["Note"] = relationship("Note", foreign_keys=[source_id], back_populates="outgoing_links")
    target: Mapped["Note"] = relationship("Note", foreign_keys=[target_id], back_populates="incoming_links")


# ─── Chat Models ───────────────────────────────────────────────

class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), default="New Chat")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    owner: Mapped["User"] = relationship("User", back_populates="chat_sessions")
    messages: Mapped[List["ChatMessage"]] = relationship(
        "ChatMessage", back_populates="session", cascade="all, delete-orphan",
        order_by="ChatMessage.created_at"
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # "user" or "assistant"
    content: Mapped[str] = mapped_column(Text, nullable=False)
    cited_note_ids: Mapped[Optional[List[str]]] = mapped_column(ARRAY(String), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    session: Mapped["ChatSession"] = relationship("ChatSession", back_populates="messages")


# ─── Semantic Cache ────────────────────────────────────────────

class SemanticCache(Base):
    __tablename__ = "semantic_cache"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    cache_key: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    query_text: Mapped[str] = mapped_column(Text, nullable=False)
    query_embedding = mapped_column(Vector(1536), nullable=True)
    response: Mapped[str] = mapped_column(Text, nullable=False)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    hit_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


# ─── Spaced Repetition Models ───────────────────────────────────

class NoteMemoryState(Base):
    __tablename__ = "note_memory_state"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    note_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    review_count: Mapped[int] = mapped_column(Integer, default=0)
    last_recall_rating: Mapped[Optional[str]] = mapped_column(VARCHAR(10), nullable=True)
    avg_recall_score: Mapped[float] = mapped_column(Float, default=0.5)
    stability: Mapped[float] = mapped_column(Float, default=1.0)
    estimated_retention: Mapped[float] = mapped_column(Float, default=1.0)
    next_review_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    interval_days: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        UniqueConstraint('note_id', 'user_id', name='uq_note_user'),
    )


class ReviewEvent(Base):
    __tablename__ = "review_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    note_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    session_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    rating: Mapped[str] = mapped_column(VARCHAR(10), nullable=False)
    interval_before: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    interval_after: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    stability_before: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    stability_after: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    retention_at_review: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    reviewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class RevisionSession(Base):
    __tablename__ = "revision_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[datetime] = mapped_column(Date, nullable=False)
    notes_due: Mapped[int] = mapped_column(Integer, default=5)
    notes_completed: Mapped[int] = mapped_column(Integer, default=0)
    notes_skipped: Mapped[int] = mapped_column(Integer, default=0)
    forgot_count: Mapped[int] = mapped_column(Integer, default=0)
    hard_count: Mapped[int] = mapped_column(Integer, default=0)
    good_count: Mapped[int] = mapped_column(Integer, default=0)
    easy_count: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    streak_count: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (
        UniqueConstraint('user_id', 'date', name='uq_user_date'),
    )


class UserRevisionStat(Base):
    __tablename__ = "user_revision_stats"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    current_streak: Mapped[int] = mapped_column(Integer, default=0)
    longest_streak: Mapped[int] = mapped_column(Integer, default=0)
    total_reviews: Mapped[int] = mapped_column(Integer, default=0)
    total_sessions: Mapped[int] = mapped_column(Integer, default=0)
    last_session_date: Mapped[Optional[datetime]] = mapped_column(Date, nullable=True)
    notes_mastered: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )
import uuid
from datetime import datetime, timedelta
from sqlalchemy import Column, String, DateTime, JSON
from sqlalchemy.dialects.postgresql import UUID
from database import Base

class PendingAgentAction(Base):
    __tablename__ = "pending_agent_actions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String, nullable=False, index=True)
    action_type = Column(String, nullable=False)   # create_note | update_note | delete_note | bulk_tag | merge_notes
    payload = Column(JSON, nullable=False)          # full action data — note_id, new_content, diff, etc.
    preview_message = Column(String, nullable=False) # human-readable "I want to update your note X..."
    expires_at = Column(DateTime, default=lambda: datetime.utcnow() + timedelta(minutes=5))
    created_at = Column(DateTime, default=datetime.utcnow)
