from __future__ import annotations
"""LLM service — multilingual routing via Groq, Gemini, and Sarvam with smart fallback."""

import json
from openai import AsyncOpenAI
from config import get_settings
from services.language import detect_language, is_indic
from services.semantic_cache import get_cached_response, set_cached_response

settings = get_settings()

# ── CLIENTS ───────────────────────────────────────────

_groq_client: AsyncOpenAI | None = None
_gemini_client: AsyncOpenAI | None = None
_sarvam_client: AsyncOpenAI | None = None


def _get_groq_client() -> AsyncOpenAI:
    """Groq client for English LLM."""
    global _groq_client
    if _groq_client is None:
        _groq_client = AsyncOpenAI(
            api_key=settings.groq_api_key,
            base_url="https://api.groq.com/openai/v1"
        )
    return _groq_client


def _get_gemini_client() -> AsyncOpenAI:
    """Gemini client for Indic LLM (primary)."""
    global _gemini_client
    if _gemini_client is None:
        _gemini_client = AsyncOpenAI(
            api_key=settings.gemini_api_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
        )
    return _gemini_client


def _get_sarvam_client() -> AsyncOpenAI:
    """Sarvam client for Indic LLM (fallback)."""
    global _sarvam_client
    if _sarvam_client is None:
        _sarvam_client = AsyncOpenAI(
            api_key=settings.sarvam_api_key,
            base_url="https://api.sarvam.ai/v1"
        )
    return _sarvam_client


# ── CALLERS ───────────────────────────────────────────

async def call_groq(prompt: str, model: str) -> str:
    client = _get_groq_client()
    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1000
    )
    return response.choices[0].message.content.strip()


async def call_gemini(prompt: str, model: str) -> str:
    client = _get_gemini_client()
    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1000
    )
    return response.choices[0].message.content.strip()


async def call_sarvam(prompt: str, model: str) -> str:
    client = _get_sarvam_client()
    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1000
    )
    return response.choices[0].message.content.strip()


# ── MAIN ROUTER WITH FALLBACK ─────────────────────────

async def llm_complete(prompt: str, lang: str | None = None) -> str:
    """Smart routing LLM completion with fallback on rate limits."""
    detected_lang = lang or detect_language(prompt)

    if is_indic(detected_lang):
        # Indic: Gemini primary → Sarvam fallback → Groq 8b last resort
        try:
            return await call_gemini(prompt, settings.llm_indic_primary)
        except Exception as e:
            if "quota" in str(e).lower() or "rate" in str(e).lower() or "429" in str(e):
                print(f"[LLM] Gemini rate limit hit, falling back to Sarvam")
                try:
                    return await call_sarvam(prompt, settings.llm_indic_fallback)
                except Exception as e2:
                    print(f"[LLM] Sarvam also failed: {e2}, using Groq 8b")
                    return await call_groq(prompt, settings.llm_english_fallback)
            raise e
    else:
        # English: Groq 70b primary → Groq 8b fallback
        try:
            return await call_groq(prompt, settings.llm_english_primary)
        except Exception as e:
            if "quota" in str(e).lower() or "rate" in str(e).lower() or "429" in str(e):
                print(f"[LLM] Groq 70b rate limit hit, falling back to 8b")
                return await call_groq(prompt, settings.llm_english_fallback)
            raise e


async def llm_complete_with_history(messages: list, lang: str | None = None) -> str:
    """Multi-turn LLM completion with full message history and fallback."""
    detected_lang = lang or "en"

    if is_indic(detected_lang):
        try:
            client = _get_gemini_client()
            response = await client.chat.completions.create(
                model=settings.llm_indic_primary, messages=messages, max_tokens=1000
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            if "quota" in str(e).lower() or "rate" in str(e).lower() or "429" in str(e):
                print(f"[LLM] Gemini rate limit, falling back to Sarvam for chat")
                try:
                    client = _get_sarvam_client()
                    response = await client.chat.completions.create(
                        model=settings.llm_indic_fallback, messages=messages, max_tokens=1000
                    )
                    return response.choices[0].message.content.strip()
                except Exception as e2:
                    print(f"[LLM] Sarvam also failed: {e2}, using Groq 8b for chat")
                    client = _get_groq_client()
                    response = await client.chat.completions.create(
                        model=settings.llm_english_fallback, messages=messages, max_tokens=1000
                    )
                    return response.choices[0].message.content.strip()
            raise e
    else:
        try:
            client = _get_groq_client()
            response = await client.chat.completions.create(
                model=settings.llm_english_primary, messages=messages, max_tokens=1000
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            if "quota" in str(e).lower() or "rate" in str(e).lower() or "429" in str(e):
                print(f"[LLM] Groq 70b rate limit, falling back to 8b for chat")
                client = _get_groq_client()
                response = await client.chat.completions.create(
                    model=settings.llm_english_fallback, messages=messages, max_tokens=1000
                )
                return response.choices[0].message.content.strip()
            raise e


# ── TASK SPECIFIC FUNCTIONS ───────────────────────────

async def generate_summary(content: str, content_language: str | None = None) -> str:
    """Generate a precise 3-sentence summary relying on smart routing."""
    lang = content_language or detect_language(content)
    cache_query = content[:500]

    cached = await get_cached_response(cache_query, cache_key="summary")
    if cached:
        return cached

    if is_indic(lang):
        summary_prompt = f"""
        Is content ka summary do same language mein:
        1. 3 sentence ka TL;DR
        2. Key concepts (bullet points)
        3. Important insights

        Content: {content[:4000]}
        """
    else:
        summary_prompt = f"""
        Summarize this content:
        1. 3-sentence TL;DR
        2. Key concepts (bullet points)
        3. Actionable insights

        Content: {content[:4000]}
        """

    result = await llm_complete(summary_prompt, lang)
    await set_cached_response(cache_query, result, cache_key="summary", ttl_hours=settings.cache_ttl_summary_hours)
    return result


async def extract_concepts(content: str) -> list[str]:
    """Extract key concepts and entities from the content."""
    cache_query = content[:500]
    cached = await get_cached_response(cache_query, cache_key="concepts")
    if cached:
        try:
            return json.loads(cached)
        except Exception:
            return [c.strip() for c in cached.split(",") if c.strip()]

    prompt = f"You are an entity extraction system. Extract key concepts, entities, and important terms from the given text. Return them as a JSON array of strings. Return ONLY the JSON array, no other text.\n\nExtract key concepts from:\n\n{content[:4000]}"
    result = await llm_complete(prompt)
    try:
        cleaned = result.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1])
        concepts = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        concepts = [c.strip().strip('"').strip("'") for c in result.split(",") if c.strip()]

    await set_cached_response(cache_query, json.dumps(concepts), cache_key="concepts", ttl_hours=settings.cache_ttl_summary_hours)
    return concepts


async def synthesize_answer(query: str, contexts: list[str], user_id: str | None = None) -> str:
    """RAG: Generate a synthesized answer from retrieved contexts."""
    cached = await get_cached_response(query, cache_key="rag", user_id=user_id)
    if cached:
        return cached

    lang = detect_language(query)
    context_block = "\n\n".join(contexts)

    if is_indic(lang):
        prompt = f"""
        Sirf neeche diye notes ke basis par answer do.
        Answer same language mein do jisme question hai.

        Notes:
        {context_block}

        Question: {query}
        """
    else:
        prompt = f"""
        Answer using ONLY the context from the notes below.

        Notes:
        {context_block}

        Question: {query}
        """

    result = await llm_complete(prompt, lang)
    await set_cached_response(query, result, cache_key="rag", user_id=user_id, ttl_hours=settings.cache_ttl_rag_hours)
    return result


async def generate_topic_name(contents: list[str]) -> str:
    """Generate a descriptive name for a topic cluster given sample contents."""
    samples = "\n---\n".join(c[:500] for c in contents[:5])
    cache_query = samples[:500]

    cached = await get_cached_response(cache_query, cache_key="topic_name")
    if cached:
        return cached

    prompt = f"You are a topic naming system. Given a set of related text excerpts, generate a short, descriptive topic name (2-5 words). Return ONLY the topic name, nothing else.\n\nGenerate a topic name for these related texts:\n\n{samples}"
    result = await llm_complete(prompt)
    await set_cached_response(cache_query, result, cache_key="topic_name", ttl_hours=settings.cache_ttl_topic_name_hours)
    return result


async def summarize_youtube_video(transcript: str, content_language: str | None = None) -> str:
    """Summarize a YouTube video transcript into structured points natively in the requested language."""
    lang = content_language or detect_language(transcript)
    cache_query = transcript[:500]

    cached = await get_cached_response(cache_query, cache_key="summary")
    if cached:
        return cached

    if is_indic(lang):
        prompt = f"""
        Neeche diye gaye YouTube video transcript ka summary do (same language mein):
        1. 3 sentence ka TL;DR
        2. Key concepts learned (bullet points)
        3. Koi bhi actionable insights

        Transcript:
        {transcript[:50000]}
        """
    else:
        prompt = f"""
        Summarize this YouTube video transcript into:
        1. A 3-sentence TL;DR
        2. Key concepts learned (bullet points)
        3. Any actionable insights

        Transcript:
        {transcript[:50000]}
        """

    result = await llm_complete(prompt, lang)
    await set_cached_response(cache_query, result, cache_key="summary", ttl_hours=settings.cache_ttl_summary_hours)
    return result
