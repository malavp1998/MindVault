from __future__ import annotations
"""Embedding service — supports OpenAI, Ollama, and Gemini backends."""

import httpx
from openai import AsyncOpenAI
from config import get_settings

settings = get_settings()

_openai_client: AsyncOpenAI | None = None


def _get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai_client


async def get_embedding(text: str) -> list[float]:
    """Generate an embedding vector for the given text."""
    text = text[:8000]

    if settings.embedding_provider == "ollama":
        return await _ollama_embedding(text)
    if settings.embedding_provider == "gemini":
        return await _gemini_embedding(text)
    return await _openai_embedding(text)


async def _openai_embedding(text: str) -> list[float]:
    client = _get_openai_client()
    response = await client.embeddings.create(
        input=text,
        model=settings.openai_embedding_model,
    )
    return response.data[0].embedding


async def _gemini_embedding(text: str) -> list[float]:
    """Get embeddings via Gemini REST API v1beta (gemini-embedding-001 = 3072 dims → truncated to 1536)."""
    model = settings.gemini_embedding_model  # e.g. "gemini-embedding-001"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent"

    async with httpx.AsyncClient() as client:
        response = await client.post(
            url,
            params={"key": settings.gemini_api_key},
            json={
                "model": f"models/{model}",
                "content": {"parts": [{"text": text}]},
                "taskType": "RETRIEVAL_DOCUMENT",
            },
            timeout=30.0,
        )
        response.raise_for_status()
        embedding = response.json()["embedding"]["values"]

    # gemini-embedding-001 outputs 3072 dims — truncate to 1536 for pgvector
    if len(embedding) > 1536:
        embedding = embedding[:1536]
    elif len(embedding) < 1536:
        embedding = embedding + [0.0] * (1536 - len(embedding))

    return embedding


async def _ollama_embedding(text: str) -> list[float]:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.ollama_base_url}/api/embeddings",
            json={
                "model": settings.ollama_embedding_model,
                "prompt": text,
            },
            timeout=60.0,
        )
        response.raise_for_status()
        data = response.json()
        embedding = data["embedding"]

        # Pad or truncate to 1536 dimensions for pgvector compatibility
        if len(embedding) < 1536:
            embedding.extend([0.0] * (1536 - len(embedding)))
        elif len(embedding) > 1536:
            embedding = embedding[:1536]

        return embedding
