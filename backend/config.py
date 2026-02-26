from __future__ import annotations
"""MindVault configuration — loaded from environment variables."""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://***REMOVED***@localhost:5432/mindvault"

    # Embedding provider: "openai" | "gemini" | "jina"
    embedding_provider: str = "jina"

    # LLM provider: "openai" | "gemini" | "groq"
    llm_provider: str = "groq"

    # OpenAI
    openai_api_key: str = ""
    openai_embedding_model: str = "text-embedding-3-small"
    openai_llm_model: str = "gpt-4o-mini"


    # Gemini
    gemini_api_key: str = ""
    gemini_embedding_model: str = "gemini-embedding-001"
    gemini_llm_model: str = "gemma-3-27b-it"

    # Multilingual Routing Keys
    groq_api_key: str = ""
    sarvam_api_key: str = ""
    jina_api_key: str = ""

    # App
    backend_url: str = "http://localhost:8000"
    frontend_url: str = "http://localhost:5173"
    recluster_every_n: int = 20

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
