from __future__ import annotations
"""LLM service — multilingual routing via Groq, Gemini, and Sarvam with smart fallback."""

import json
from openai import AsyncOpenAI
from config import get_settings
from services.language import detect_language, is_indic

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


# ── TASK SPECIFIC FUNCTIONS ───────────────────────────

async def generate_summary(content: str, content_language: str | None = None) -> str:
    """Generate a precise 3-sentence summary relying on smart routing."""
    lang = content_language or detect_language(content)

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

    return await llm_complete(summary_prompt, lang)


async def extract_concepts(content: str) -> list[str]:
    """Extract key concepts and entities from the content."""
    prompt = f"You are an entity extraction system. Extract key concepts, entities, and important terms from the given text. Return them as a JSON array of strings. Return ONLY the JSON array, no other text.\n\nExtract key concepts from:\n\n{content[:4000]}"
    result = await llm_complete(prompt)
    try:
        cleaned = result.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1])
        return json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        return [c.strip().strip('"').strip("'") for c in result.split(",") if c.strip()]


async def synthesize_answer(query: str, contexts: list[str]) -> str:
    """RAG: Generate a synthesized answer from retrieved contexts."""
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

    return await llm_complete(prompt, lang)


async def generate_topic_name(contents: list[str]) -> str:
    """Generate a descriptive name for a topic cluster given sample contents."""
    samples = "\n---\n".join(c[:500] for c in contents[:5])
    prompt = f"You are a topic naming system. Given a set of related text excerpts, generate a short, descriptive topic name (2-5 words). Return ONLY the topic name, nothing else.\n\nGenerate a topic name for these related texts:\n\n{samples}"
    return await llm_complete(prompt)


async def summarize_youtube_video(transcript: str, content_language: str | None = None) -> str:
    """Summarize a YouTube video transcript into structured points natively in the requested language."""
    lang = content_language or detect_language(transcript)
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

    return await llm_complete(prompt, lang)
