from __future__ import annotations
"""MindVault — AI-Powered Knowledge Management System."""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from routes.notes import router as notes_router
from routes.topics import router as topics_router
from routes.graph import router as graph_router
from mcp_server import mcp

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup."""
    logger.info("🚀 Starting MindVault...")
    await init_db()
    logger.info("✅ Database initialized with pgvector extension")
    yield
    logger.info("👋 MindVault shutting down")


app = FastAPI(
    title="MindVault",
    description="AI-Powered Knowledge Management System",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# REST API routes
app.include_router(notes_router, prefix="/api")
app.include_router(topics_router, prefix="/api")
app.include_router(graph_router, prefix="/api")

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
