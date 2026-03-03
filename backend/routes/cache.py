from __future__ import annotations
"""Cache stats and management endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import User
from middleware.auth import CurrentUser
from services.semantic_cache import invalidate_user_cache

router = APIRouter(prefix="/cache", tags=["cache"])


@router.get("/stats")
async def get_cache_stats(
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Get semantic cache statistics."""
    result = await db.execute(
        text("""
            SELECT
                COUNT(*) as total_entries,
                COALESCE(SUM(hit_count), 0) as total_hits,
                COALESCE(AVG(hit_count), 0)::float as avg_hits,
                COUNT(*) FILTER (WHERE user_id IS NULL) as global_entries,
                COUNT(*) FILTER (WHERE user_id = CAST(:uid AS uuid)) as personal_entries,
                COUNT(*) FILTER (WHERE cache_key = 'summary') as summary_entries,
                COUNT(*) FILTER (WHERE cache_key = 'tags') as tag_entries,
                COUNT(*) FILTER (WHERE cache_key = 'rag') as rag_entries,
                COUNT(*) FILTER (WHERE cache_key = 'chat') as chat_entries,
                COUNT(*) FILTER (WHERE cache_key = 'concepts') as concept_entries,
                COUNT(*) FILTER (WHERE cache_key = 'topic_name') as topic_name_entries,
                COUNT(*) FILTER (WHERE expires_at > NOW()) as active_entries,
                COUNT(*) FILTER (WHERE expires_at <= NOW()) as expired_entries
            FROM semantic_cache
            WHERE user_id IS NULL OR user_id = CAST(:uid AS uuid)
        """),
        {"uid": str(current_user.id)},
    )
    row = result.first()

    total = int(row.total_entries)
    hits = int(row.total_hits)

    return {
        "total_entries": total,
        "active_entries": int(row.active_entries),
        "expired_entries": int(row.expired_entries),
        "total_hits": hits,
        "avg_hits_per_entry": round(float(row.avg_hits), 1),
        "global_entries": int(row.global_entries),
        "personal_entries": int(row.personal_entries),
        "by_type": {
            "summary": int(row.summary_entries),
            "tags": int(row.tag_entries),
            "concepts": int(row.concept_entries),
            "topic_name": int(row.topic_name_entries),
            "rag": int(row.rag_entries),
            "chat": int(row.chat_entries),
        },
        "estimated_api_calls_saved": hits,
        "cache_hit_rate": round(hits / max(total + hits, 1) * 100, 1),
    }


@router.delete("/clear", status_code=200)
async def clear_my_cache(current_user: User = CurrentUser):
    """Clear all cache entries for the current user."""
    await invalidate_user_cache(str(current_user.id))
    return {"message": "Your cache cleared"}
