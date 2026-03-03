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
from routes.chat import router as chat_router
from routes.cache import router as cache_router
from routes.auth import limiter
from mcp_server import mcp
from services.semantic_cache import cleanup_expired_cache

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup."""
    logger.info("🚀 Starting MindVault...")
    await init_db()
    logger.info("✅ Database initialized with pgvector extension")
    await cleanup_expired_cache()
    logger.info("🧹 Expired cache cleaned on startup")
    yield
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
    allow_origin_regex=r"(http://localhost:\d+|https://.*\.vercel\.app|https://.*\.onrender\.com|chrome-extension://.*)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# REST API routes
app.include_router(auth_router)           # /auth/* — public (no JWT)
app.include_router(notes_router, prefix="/api")
app.include_router(topics_router, prefix="/api")
app.include_router(graph_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(cache_router, prefix="/api")

# MCP server mount
app.mount("/mcp", mcp.streamable_http_app())


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
