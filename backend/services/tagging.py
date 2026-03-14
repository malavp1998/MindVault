from __future__ import annotations
"""Service for automatically tagging notes and managing tag states."""

import json
from services.llm import llm_complete
from services.language import is_indic
from services.semantic_cache import get_cached_response, set_cached_response
from langsmith import traceable
from config import get_settings

settings = get_settings()


@traceable(name="generate_tags", tags=["pipeline", "tagging"])
async def generate_tags(content: str, lang: str, bypass_cache: bool = False) -> list[str]:
    """Uses LLM to automatically generate 3-5 relevant tags for the note content."""
    cache_query = content[:500]
    cached = await get_cached_response(cache_query, cache_key="tags", bypass_cache=bypass_cache)
    if cached:
        return [t.strip() for t in cached.split(",") if t.strip()]

    if is_indic(lang):
        prompt = f"""<role>Aap ek precise metadata tagging system hain personal knowledge vault ke liye.</role>

<task>Neeche diye note ke liye 3-5 concise tags extract karo.</task>

<rules>
- Tags 1-3 words, lowercase, no punctuation
- Specific prefer karo generic se: "transformer attention" better than "ai"
- Return ONLY a JSON array of strings — no markdown, no explanation
</rules>

<example>
Input: "Python asyncio event loop aur FastAPI ke baare mein article"
Output: ["asyncio", "python", "event loop", "fastapi", "async programming"]
</example>

<note>{content[:1000]}</note>

Output:"""
    else:
        prompt = f"""<role>You are a precise metadata tagging system for a personal knowledge vault.</role>

<task>Extract 3-5 concise, lowercase tags from the note content below.</task>

<rules>
- Tags must be 1-3 words, lowercase, no punctuation
- Prefer specific over generic ("transformer attention" over "ai")
- Return ONLY a JSON array of strings — no markdown fences, no explanation
</rules>

<example>
Input: "Article about Python asyncio event loop and coroutines for FastAPI"
Output: ["asyncio", "python", "event loop", "fastapi", "coroutines"]
</example>

<note>{content[:1000]}</note>

Output:"""

    response = await llm_complete(prompt, lang)

    try:
        cleaned = response.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1])
        tags = json.loads(cleaned)
        # Validate: must be a list of short strings
        tags = [
            t.strip().lower() for t in tags
            if isinstance(t, str) and 1 < len(t.strip()) < 40
        ][:5]
    except (json.JSONDecodeError, ValueError, TypeError):
        tags = []

    if tags:
        await set_cached_response(cache_query, ",".join(tags), cache_key="tags", ttl_hours=settings.cache_ttl_tags_hours)
    return tags


def merge_tags(auto_tags: list[str], user_tags: list[str]) -> dict:
    """Format tags for dual UI display."""
    return {
        "auto": auto_tags,
        "user": user_tags,
        "all": list(set(auto_tags + user_tags))
    }

