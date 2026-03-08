from __future__ import annotations
"""Embedding service — supports Jina AI backend."""

from httpx import Timeout
from openai import AsyncOpenAI
from langsmith.wrappers import wrap_openai
from langsmith import traceable
from config import get_settings

settings = get_settings()

_jina_client: AsyncOpenAI | None = None


def _get_jina_client() -> AsyncOpenAI:
    global _jina_client
    if _jina_client is None:
        _jina_client = wrap_openai(AsyncOpenAI(
            api_key=settings.jina_api_key,
            base_url="https://api.jina.ai/v1",
            timeout=Timeout(
                connect=10.0,
                read=60.0,
                write=10.0,
                pool=5.0
            ),
            max_retries=2
        ))
    return _jina_client


@traceable(name="get_embedding", tags=["embedding", "jina"])
async def get_embedding(text: str) -> list[float]:
    """Generate an embedding vector for the given text using Jina AI."""
    text = text[:8000]
    client = _get_jina_client()
    
    response = await client.embeddings.create(
        input=text,
        model="jina-embeddings-v3"
    )
    embedding = response.data[0].embedding
    
    # Pad or truncate to 1536 dimensions for pgvector compatibility
    if len(embedding) < 1536:
        embedding.extend([0.0] * (1536 - len(embedding)))
    elif len(embedding) > 1536:
        embedding = embedding[:1536]
        
    return embedding
