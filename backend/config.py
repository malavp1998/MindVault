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

    # LLM Model Settings
    llm_english_primary: str = "llama-3.3-70b-versatile"
    llm_english_fallback: str = "llama-3.1-8b-instant"
    llm_indic_primary: str = "gemini-1.5-flash"
    llm_indic_fallback: str = "sarvam-2b"

    # Twilio
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""

    # Auth Settings
    auth_method: str = "credentials"  # "credentials" or "otp"
    firebase_project_id: str = "mindvault-1"

    # OTP settings (only used if auth_method="otp")
    otp_expire_minutes: int = 10

    # Semantic Cache
    cache_similarity_threshold: float = 0.80
    cache_ttl_summary_hours: int = 24
    cache_ttl_tags_hours: int = 48
    cache_ttl_topic_name_hours: int = 72
    cache_ttl_rag_hours: int = 6
    cache_ttl_chat_hours: int = 1

    # App
    backend_url: str = "http://localhost:8000"
    frontend_url: str = "http://localhost:5173"
    recluster_every_n: int = 20

    # Spaced Repetition Settings
    REVISION_THRESHOLD: int = 5
    MAX_INTERVAL_DAYS: int = 180
    MASTERED_THRESHOLD_DAYS: int = 60

    # LangSmith Monitoring
    langchain_tracing_v2: str = "true"
    langchain_api_key: str = ""
    langchain_project: str = "MindVault"
    langchain_endpoint: str = "https://api.smith.langchain.com"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
