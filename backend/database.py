from __future__ import annotations
"""Async SQLAlchemy engine and session management with pgvector support."""

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
from config import get_settings

settings = get_settings()

# asyncpg doesn't support query params like ?sslmode=require&channel_binding=require
# Strip ALL query params from the URL and pass ssl=True via connect_args instead
from urllib.parse import urlparse, urlunparse

_raw_url = settings.database_url
_parsed = urlparse(_raw_url)
_needs_ssl = bool(_parsed.query)  # any query params → cloud DB → needs SSL

# Rebuild URL without query string
_db_url = urlunparse(_parsed._replace(query=""))
_connect_args = {"ssl": True} if _needs_ssl else {}

engine = create_async_engine(
    _db_url,
    echo=False,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
    connect_args=_connect_args,
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    """Create pgvector extension and all tables."""
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128) UNIQUE"
        ))
        # Add graph coordinate columns if they don't exist (for existing DBs)
        await conn.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS graph_x FLOAT"))
        await conn.execute(text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS graph_y FLOAT"))
        # Full-text search index for hybrid search (BM25)
        await conn.execute(text("""
            ALTER TABLE notes
            ADD COLUMN IF NOT EXISTS fts tsvector
            GENERATED ALWAYS AS (
                to_tsvector('english',
                    coalesce(title, '') || ' ' ||
                    coalesce(content, '') || ' ' ||
                    coalesce(summary, '')
                )
            ) STORED
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS notes_fts_idx ON notes USING GIN(fts)
        """))
        # firebase_uid migration for existing users table
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128)"))
        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_firebase_uid ON users(firebase_uid)"))
        
        # Drop old unique constraint on cluster_id causing recluster crashes for existing DBs
        await conn.execute(text("ALTER TABLE topics DROP CONSTRAINT IF EXISTS topics_cluster_id_key"))


async def get_db() -> AsyncSession:
    """Dependency that yields a database session."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

