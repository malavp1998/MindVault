from __future__ import annotations
"""LangSmith monitoring — initializes tracing for all AI operations."""

import os
from config import get_settings

settings = get_settings()

# Set LangSmith env vars from config (must happen before any langsmith imports)
os.environ["LANGCHAIN_TRACING_V2"] = settings.langchain_tracing_v2
os.environ["LANGCHAIN_API_KEY"] = settings.langchain_api_key
os.environ["LANGCHAIN_PROJECT"] = settings.langchain_project
os.environ["LANGCHAIN_ENDPOINT"] = settings.langchain_endpoint

try:
    from langsmith import Client
    langsmith_client = Client()
except Exception:
    langsmith_client = None


def is_monitoring_enabled() -> bool:
    """Check if LangSmith monitoring is configured."""
    return bool(settings.langchain_api_key and settings.langchain_api_key != "your_langsmith_api_key")
