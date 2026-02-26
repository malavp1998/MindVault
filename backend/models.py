from __future__ import annotations
"""SQLAlchemy models for MindVault."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, DateTime, Float, ForeignKey, Integer, JSON, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from pgvector.sqlalchemy import Vector
from database import Base


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list) # Legacy, optionally remove later
    auto_tags: Mapped[list[str]] = mapped_column(ARRAY(String), server_default="{}")
    user_tags: Mapped[list[str]] = mapped_column(ARRAY(String), server_default="{}")
    processed: Mapped[bool] = mapped_column(Boolean, server_default="false")
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_concepts: Mapped[list | None] = mapped_column(JSON, nullable=True)
    language: Mapped[str] = mapped_column(String(10), default="en")
    topic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("topics.id"), nullable=True
    )
    embedding = mapped_column(Vector(1536), nullable=True)
    is_processed: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    topic: Mapped["Topic | None"] = relationship("Topic", back_populates="notes")
    outgoing_links: Mapped[list["NoteLink"]] = relationship(
        "NoteLink", foreign_keys="NoteLink.source_id", back_populates="source", cascade="all, delete-orphan"
    )
    incoming_links: Mapped[list["NoteLink"]] = relationship(
        "NoteLink", foreign_keys="NoteLink.target_id", back_populates="target", cascade="all, delete-orphan"
    )


class Topic(Base):
    __tablename__ = "topics"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    cluster_id: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    centroid = mapped_column(Vector(1536), nullable=True)
    note_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    notes: Mapped[list["Note"]] = relationship("Note", back_populates="topic")


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
