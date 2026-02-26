from __future__ import annotations
"""LLM service — supports OpenAI, Ollama, and Gemini for text generation."""

import httpx
import json
from openai import AsyncOpenAI
from config import get_settings

settings = get_settings()

_openai_client: AsyncOpenAI | None = None


def _get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai_client


async def _call_llm(system_prompt: str, user_prompt: str) -> str:
    """Route LLM call to OpenAI, Ollama, or Gemini."""
    if settings.llm_provider == "ollama":
        return await _ollama_generate(system_prompt, user_prompt)
    if settings.llm_provider == "gemini":
        return await _gemini_generate(system_prompt, user_prompt)
    return await _openai_generate(system_prompt, user_prompt)


async def _openai_generate(system_prompt: str, user_prompt: str) -> str:
    client = _get_openai_client()
    response = await client.chat.completions.create(
        model=settings.openai_llm_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
        max_tokens=1000,
    )
    return response.choices[0].message.content.strip()


async def _gemini_generate(system_prompt: str, user_prompt: str) -> str:
    """Generate text via Gemini REST API v1beta (gemini-2.5-flash)."""
    model = settings.gemini_llm_model  # e.g. "gemini-2.5-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    # Gemini uses system_instruction as a separate top-level field
    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 1000},
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            url,
            params={"key": settings.gemini_api_key},
            json=payload,
            timeout=60.0,
        )
        response.raise_for_status()
        data = response.json()
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()


async def _ollama_generate(system_prompt: str, user_prompt: str) -> str:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": settings.ollama_llm_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "stream": False,
            },
            timeout=120.0,
        )
        response.raise_for_status()
        return response.json()["message"]["content"].strip()


async def generate_summary(content: str) -> str:
    """Generate a concise 3-sentence summary of the content."""
    return await _call_llm(
        system_prompt="You are a precise summarizer. Generate exactly 3 sentences that capture the key points of the given text. Be concise and informative.",
        user_prompt=f"Summarize the following text in exactly 3 sentences:\n\n{content[:4000]}",
    )


async def extract_concepts(content: str) -> list[str]:
    """Extract key concepts and entities from the content."""
    result = await _call_llm(
        system_prompt="You are an entity extraction system. Extract key concepts, entities, and important terms from the given text. Return them as a JSON array of strings. Return ONLY the JSON array, no other text.",
        user_prompt=f"Extract key concepts from:\n\n{content[:4000]}",
    )
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
    context_block = "\n\n---\n\n".join(
        f"[Source {i+1}]:\n{ctx}" for i, ctx in enumerate(contexts)
    )
    return await _call_llm(
        system_prompt="You are a knowledgeable assistant answering questions based on the user's personal notes. Use the provided source notes to answer the question accurately. Cite sources using [Source N] notation. If the sources don't contain relevant information, say so.",
        user_prompt=f"Question: {query}\n\nRelevant notes from vault:\n\n{context_block}",
    )


async def generate_topic_name(contents: list[str]) -> str:
    """Generate a descriptive name for a topic cluster given sample contents."""
    samples = "\n---\n".join(c[:500] for c in contents[:5])
    return await _call_llm(
        system_prompt="You are a topic naming system. Given a set of related text excerpts, generate a short, descriptive topic name (2-5 words). Return ONLY the topic name, nothing else.",
        user_prompt=f"Generate a topic name for these related texts:\n\n{samples}",
    )
