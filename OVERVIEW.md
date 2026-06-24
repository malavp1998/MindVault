# MindVault — Overview

> **AI-Powered Knowledge Management System** — Your personal second brain.

---

## What is MindVault?

MindVault is a full-stack, AI-powered knowledge management system that helps you **save, organize, and rediscover** everything you learn. It ingests content from web pages, YouTube videos, voice notes, Slack messages, and manual entries — then automatically summarizes, tags, clusters, and semantically links everything into an interactive knowledge graph.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **🧠 AI Ingestion Pipeline** | Auto-summarize, tag, embed, and link every note you save |
| **🔍 Hybrid Semantic Search** | Vector similarity + BM25 full-text with RRF fusion + optional RAG answers |
| **📚 Knowledge Graph** | Interactive 2D graph with topic clusters and semantic edges (powered by UMAP + HDBSCAN) |
| **💬 Agentic Chat** | LangGraph-powered AI assistant that can read your vault AND propose writes (with confirmation) |
| **🔄 Spaced Repetition** | FSRS-inspired algorithm to review notes just before you forget them |
| **🔗 MCP Server** | Claude Desktop integration via Model Context Protocol |
| **💼 Slack Bot** | Save notes and search your vault from Slack DMs |
| **🌐 Chrome Extension** | Save web pages and YouTube videos directly from your browser |
| **🌍 Multilingual** | Supports English + 10 Indic languages with smart LLM routing (Groq, Gemini, Sarvam) |
| **⚡ Semantic Caching** | Avoids redundant LLM calls via pgvector similarity cache |

---

## Tech Stack

```
Frontend:    React 18 + Vite + react-router
Backend:     FastAPI + Python 3.11+
Database:    PostgreSQL 16 + pgvector (1536d)
AI Agents:   LangGraph, LangChain, LangSmith
Embeddings:  Jina AI (jina-embeddings-v3, 1536d)
LLMs:        Groq (Llama), Gemini, Sarvam AI (Indic)
Clustering:  UMAP + HDBSCAN (PCA fallback for small vaults)
Search:      pgvector + tsvector + RRF fusion
Cache:       pgvector semantic cache (per-key TTL)
Auth:        Firebase Admin SDK (mock auth for local dev)
Deployment:  Docker Compose, Render-ready
```

---

## Architecture at a Glance

```
┌─ Clients ───────────────────────────────────────────────┐
│  Web UI │ Chrome Ext. │ Claude Desktop │ Slack │   API  │
└────────────────────────┬────────────────────────────────┘
                         │
┌─ Backend ──────────────▼────────────────────────────────┐
│  REST API (FastAPI)      MCP Server (FastMCP)           │
│  ┌─────────────────────────────────────────────────────┐│
│  │              AI Service Layer                       ││
│  │  Embedding → LLM Routing → Semantic Cache          ││
│  │  Clustering (UMAP+HDBSCAN) → Agents (LangGraph)    ││
│  │  Spaced Repetition (FSRS) → Language Detection     ││
│  └─────────────────────────────────────────────────────┘│
└────────────────────────┬────────────────────────────────┘
                         │
┌─ Database ─────────────▼────────────────────────────────┐
│  PostgreSQL 16 + pgvector — Notes, Topics, Vectors,     │
│  Chat History, Cache, Revision State                   │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Architecture Diagram

### Ingestion Flow

```
Save a note → Embedding (Jina AI, 1536d)
           → LLM Summary (structured JSON)
           → LLM Auto-tags (3-5 tags)
           → Bidirectional semantic links (pgvector)
           → Invalidate semantic cache
           → Incremental or full HDBSCAN recluster
           → Initialize spaced repetition state
           → Store 2D graph coordinates
```

### Search Flow

```
Query → Embedding (Jina AI)  ──┐
      → BM25 (Postgres FTS)  ──┤ → RRF Fusion → Top-K → Optional RAG
```

### Agentic Chat Flow

```
User Message → Intent Classifier (READ/WRITE)
                ├── READ  → search_vault → synthesize answer
                └── WRITE → propose action → user confirms → execute
```

---

## Getting Started

```bash
# 1. Clone & install
git clone <repo> && cd mindvault

# 2. Backend
cd backend && pip install -r requirements.txt
cp .env.example .env   # configure API keys
docker compose up -d db   # start PostgreSQL
uvicorn main:app --reload

# 3. Frontend
cd frontend && npm install && npm run dev
```

---

## When to Use What

| I want to… | Use |
|------------|-----|
| Save a web article | Web UI or Chrome Extension |
| Save a YouTube video | Chrome Extension (client-side transcript) |
| Take a voice note | Web UI (audio upload) |
| Search my knowledge | Search page or Chat |
| See how things connect | Knowledge Graph page |
| Review what I'm forgetting | Revision page (spaced repetition) |
| Save/search from Slack | DM the Slack bot |
| Use from Claude Desktop | Connect via MCP |
| Write a script against it | REST API or MCP tools |

---

## Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Full detailed architecture
- **API Docs:** `http://localhost:8000/docs` (FastAPI Swagger)
- **MCP:** `http://localhost:8000/mcp` (Claude Desktop)
