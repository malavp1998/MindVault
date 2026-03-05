from __future__ import annotations
"""Semantic cache — caches LLM responses by query similarity using pgvector."""

import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, text, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from services.embedding import get_embedding
from database import async_session
from langsmith import traceable
from langsmith.run_helpers import get_current_run_tree

settings = get_settings()
logger = logging.getLogger(__name__)


@traceable(name="semantic_cache_lookup", tags=["cache"])
async def get_cached_response(
    query: str,
    cache_key: str,
    user_id: str | None = None,
) -> str | None:
    """Check cache for a semantically similar query. Returns cached response or None."""
    try:
        query_embedding = await get_embedding(query)

        params = {
            "emb": str(query_embedding),
            "key": cache_key,
            "threshold": settings.cache_similarity_threshold,
        }

        if user_id:
            sql = """
                SELECT id, response,
                       1 - (query_embedding <=> CAST(:emb AS vector)) as similarity
                FROM semantic_cache
                WHERE cache_key = :key
                  AND user_id = CAST(:uid AS uuid)
                  AND expires_at > NOW()
                  AND 1 - (query_embedding <=> CAST(:emb AS vector)) >= :threshold
                ORDER BY query_embedding <=> CAST(:emb AS vector)
                LIMIT 1
            """
            params["uid"] = user_id
        else:
            sql = """
                SELECT id, response,
                       1 - (query_embedding <=> CAST(:emb AS vector)) as similarity
                FROM semantic_cache
                WHERE cache_key = :key
                  AND user_id IS NULL
                  AND expires_at > NOW()
                  AND 1 - (query_embedding <=> CAST(:emb AS vector)) >= :threshold
                ORDER BY query_embedding <=> CAST(:emb AS vector)
                LIMIT 1
            """

        async with async_session() as db:
            result = await db.execute(text(sql), params)
            row = result.first()

            if row:
                cache_id, response, similarity = row
                await db.execute(
                    text("UPDATE semantic_cache SET hit_count = hit_count + 1 WHERE id = CAST(:id AS uuid)"),
                    {"id": str(cache_id)},
                )
                await db.commit()
                logger.info(f"[SemanticCache] HIT key={cache_key} similarity={similarity:.3f}")
                run = get_current_run_tree()
                if run:
                    run.metadata["cache_hit"] = True
                    run.metadata["cache_similarity"] = round(float(similarity), 3)
                    run.metadata["cache_key"] = cache_key
                return response

        logger.info(f"[SemanticCache] MISS key={cache_key}")
        run = get_current_run_tree()
        if run:
            run.metadata["cache_hit"] = False
            run.metadata["cache_key"] = cache_key
        return None

    except Exception as e:
        logger.warning(f"[SemanticCache] ERROR on get: {e}")
        return None


@traceable(name="semantic_cache_set", tags=["cache"])
async def set_cached_response(
    query: str,
    response: str,
    cache_key: str,
    user_id: str | None = None,
    ttl_hours: int = 24,
) -> None:
    """Store a response in the semantic cache."""
    try:
        import uuid as _uuid
        query_embedding = await get_embedding(query)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
        entry_id = str(_uuid.uuid4())

        params = {
            "id": entry_id,
            "key": cache_key,
            "query": query[:1000],
            "emb": str(query_embedding),
            "response": response,
            "expires": expires_at,
            "now": datetime.now(timezone.utc),
        }

        async with async_session() as db:
            if user_id:
                params["uid"] = user_id
                await db.execute(
                    text("""
                        INSERT INTO semantic_cache
                        (id, cache_key, query_text, query_embedding, response, user_id, hit_count, created_at, expires_at)
                        VALUES (CAST(:id AS uuid), :key, :query, CAST(:emb AS vector), :response, CAST(:uid AS uuid), 0, :now, :expires)
                    """),
                    params,
                )
            else:
                await db.execute(
                    text("""
                        INSERT INTO semantic_cache
                        (id, cache_key, query_text, query_embedding, response, hit_count, created_at, expires_at)
                        VALUES (CAST(:id AS uuid), :key, :query, CAST(:emb AS vector), :response, 0, :now, :expires)
                    """),
                    params,
                )
            await db.commit()
            logger.info(f"[SemanticCache] SET key={cache_key} ttl={ttl_hours}h")

    except Exception as e:
        logger.warning(f"[SemanticCache] ERROR on set: {e}")


async def cleanup_expired_cache() -> int:
    """Delete expired cache entries."""
    try:
        async with async_session() as db:
            result = await db.execute(
                text("DELETE FROM semantic_cache WHERE expires_at < NOW()")
            )
            await db.commit()
            deleted = result.rowcount or 0
            logger.info(f"[SemanticCache] Cleaned {deleted} expired entries")
            return deleted
    except Exception as e:
        logger.warning(f"[SemanticCache] ERROR on cleanup: {e}")
        return 0


async def invalidate_user_cache(user_id: str, cache_key: str | None = None) -> None:
    """Invalidate cache entries for a user, optionally by key."""
    try:
        async with async_session() as db:
            if cache_key:
                await db.execute(
                    text("DELETE FROM semantic_cache WHERE user_id = CAST(:uid AS uuid) AND cache_key = :key"),
                    {"uid": user_id, "key": cache_key},
                )
            else:
                await db.execute(
                    text("DELETE FROM semantic_cache WHERE user_id = CAST(:uid AS uuid)"),
                    {"uid": user_id},
                )
            await db.commit()
            logger.info(f"[SemanticCache] Invalidated user={user_id} key={cache_key or 'all'}")
    except Exception as e:
        logger.warning(f"[SemanticCache] ERROR on invalidate: {e}")
