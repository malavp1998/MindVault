from __future__ import annotations
"""MindVault — AI-Powered Knowledge Management System."""

import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from routes.auth import router as auth_router
from routes.notes import router as notes_router
from routes.topics import router as topics_router
from routes.graph import router as graph_router
from routes.cache import router as cache_router
from routes.auth import limiter
from mcp_server import mcp
from services.semantic_cache import cleanup_expired_cache
from services.monitoring import is_monitoring_enabled
from services.revision_selector import update_retention_scores
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from config import get_settings

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


mcp_app = mcp.streamable_http_app()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup."""
    logger.info("🚀 Starting MindVault...")
    
    # LangSmith Init
    settings = get_settings()
    if is_monitoring_enabled():
        logger.info(f"📊 [LangSmith] Monitoring enabled → project: {settings.langchain_project}")
    else:
        logger.info("ℹ️ [LangSmith] Monitoring disabled — add LANGCHAIN_API_KEY to .env")
        
    await init_db()
    logger.info("✅ Database initialized with pgvector extension")
    await cleanup_expired_cache()
    logger.info("🧹 Expired cache cleaned on startup")
    
    # Setup Spaced Repetition nightly job
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        update_retention_scores,
        trigger="cron",
        hour=0,
        minute=0,
        id="update_retention_scores",
        replace_existing=True
    )
    scheduler.start()
    logger.info("📅 APScheduler started with update_retention_scores job")
    
    # Initialize FastMCP SSE manager lifespan
    async with mcp_app.router.lifespan_context(mcp_app):
        yield

    scheduler.shutdown()
    logger.info("👋 MindVault shutting down")


app = FastAPI(
    title="MindVault",
    description="AI-Powered Knowledge Management System",
    version="1.0.0",
    lifespan=lifespan,
)

# Rate Limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — allow dashboard, extension, and localhost origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# REST API routes
app.include_router(auth_router)           # /auth/* — public (no JWT)
app.include_router(notes_router, prefix="/api")
app.include_router(topics_router, prefix="/api")
app.include_router(graph_router, prefix="/api")
app.include_router(cache_router, prefix="/api")

from routes.revision import router as revision_router
app.include_router(revision_router, prefix="/api")

from routes.agentic_chat import router as agentic_chat_router
app.include_router(agentic_chat_router)

from routes.eval import router as eval_router
app.include_router(eval_router)

from routes.slack import router as slack_router
app.include_router(slack_router, prefix="/slack", tags=["slack"])

from routes.whatsapp import router as whatsapp_router
app.include_router(whatsapp_router, prefix="/whatsapp", tags=["whatsapp"])

# MCP server direct route injection instead of mount to avoid /mcp/mcp duplication
app.routes.extend(mcp_app.routes)


@app.get("/")
async def root():
    return {
        "name": "MindVault",
        "version": "1.0.0",
        "docs": "/docs",
        "mcp": "/mcp",
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
