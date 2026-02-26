# 🧠 MindVault — AI-Powered Knowledge Management System

An intelligent second brain that captures, processes, links, and surfaces knowledge using semantic embeddings and AI. Like Obsidian meets RAG.

## Architecture

```
┌─────────────────┐     ┌─────────────────────────────────────┐
│  Chrome Extension│────▶│         FastAPI Backend              │
│  (Manifest V3)  │ REST│  ┌─────────────┐  ┌──────────────┐  │
│  • Save pages   │────▶│  │  REST API    │  │  MCP Server  │  │
│  • Related notes│     │  │  /api/notes  │  │  /mcp        │  │
│  • Annotations  │     │  │  /api/topics │  │  • search    │  │
└─────────────────┘     │  └──────┬──────┘  │  • add_note  │  │
                        │         │         │  • related   │  │
┌─────────────────┐     │  ┌──────▼──────┐  │  • topics    │  │
│  React Dashboard│────▶│  │ AI Pipeline │  └──────────────┘  │
│  (Vite + TW)    │     │  │ • Embed     │                    │
│  • /vault       │     │  │ • Summarize │  ┌──────────────┐  │
│  • /topics      │     │  │ • Concepts  │  │ PostgreSQL   │  │
│  • /note/:id    │     │  │ • Cluster   │  │ + pgvector   │  │
│  • /search      │     │  │ • Link      │──│              │  │
└─────────────────┘     │  └─────────────┘  └──────────────┘  │
                        └─────────────────────────────────────┘
                                    ▲
┌─────────────────┐                 │
│  Claude Desktop │─── MCP ─────────┘
│  / MCP Client   │
└─────────────────┘
```

## Quick Start

### Prerequisites
- Docker & Docker Compose
- A Gemini API key (or OpenAI/Ollama)

### 1. Clone & Configure

```bash
cd mindvault
cp .env.example .env
# Edit .env with your API keys
```

### 2. Start Everything

```bash
docker compose up --build
```

This starts:
- **PostgreSQL + pgvector** on port `5432`
- **FastAPI backend** on port `8000` (API docs at `/docs`)
- **React dashboard** on port `5173`

### 3. Install Chrome Extension

1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select the `extension/` folder

### 4. Connect MCP Client (optional)

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mindvault": {
      "url": "http://localhost:8000/mcp"
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://***REMOVED***@localhost:5432/mindvault` | PostgreSQL connection |
| `EMBEDDING_PROVIDER` | `gemini` | `gemini`, `openai`, or `ollama` |
| `LLM_PROVIDER` | `gemini` | `gemini`, `openai`, or `ollama` |
| `GEMINI_API_KEY` | — | Your Gemini API key |
| `GEMINI_LLM_MODEL` | `gemma-3-27b-it` | Gemini model for LLM |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | Gemini model for embeddings |
| `OPENAI_API_KEY` | — | Your OpenAI API key |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model |
| `OPENAI_LLM_MODEL` | `gpt-4o-mini` | LLM model |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `RECLUSTER_EVERY_N` | `20` | Re-cluster notes every N new notes |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/notes` | Create a new note |
| `GET` | `/api/notes` | List all notes (filterable) |
| `GET` | `/api/notes/search?q=` | Semantic search + optional RAG |
| `GET` | `/api/notes/related?url=` | Find related notes |
| `GET` | `/api/notes/{id}` | Get note with backlinks |
| `POST` | `/api/notes/{id}/process` | Trigger AI processing |
| `DELETE` | `/api/notes/{id}` | Delete a note |
| `GET` | `/api/topics` | List topic clusters |
| `POST` | `/api/topics/{id}/summarize` | AI topic summary |

## MCP Tools

| Tool | Description |
|------|-------------|
| `search_vault(query)` | Semantic search across all notes |
| `add_note(content, title, source)` | Save and process a new note |
| `get_related(note_id)` | Get linked notes |
| `list_topics()` | List all topic clusters |
| `summarize_topic(topic_id)` | Generate topic summary |

## Project Structure

```
mindvault/
├── backend/
│   ├── main.py              # FastAPI app entry
│   ├── config.py             # Pydantic settings
│   ├── database.py           # Async SQLAlchemy + pgvector
│   ├── models.py             # Note, Topic, NoteLink models
│   ├── schemas.py            # Request/response schemas
│   ├── mcp_server.py         # MCP server (5 tools)
│   ├── routes/
│   │   ├── notes.py          # Note CRUD + search
│   │   └── topics.py         # Topic endpoints
│   └── services/
│       ├── embedding.py      # OpenAI / Ollama embeddings
│       ├── llm.py            # Summary, concepts, RAG
│       ├── clustering.py     # Agglomerative clustering
│       └── pipeline.py       # AI processing orchestration
├── frontend/
│   ├── src/
│   │   ├── App.jsx           # Routes + sidebar
│   │   ├── api.js            # Axios API client
│   │   ├── index.css         # Design system
│   │   └── pages/
│   │       ├── VaultPage.jsx   # Masonry grid
│   │       ├── TopicsPage.jsx  # Force-directed graph
│   │       ├── NotePage.jsx    # Note detail + backlinks
│   │       └── SearchPage.jsx  # Semantic search + RAG
│   └── package.json
├── extension/
│   ├── manifest.json         # Manifest V3
│   ├── content.js            # Sidebar injection
│   ├── background.js         # Service worker
│   ├── sidebar.css           # Dark theme styles
│   └── lib/Readability.js    # Content extraction
├── docker-compose.yml
├── .env.example
└── README.md
```

## Tech Stack

- **Backend**: FastAPI, SQLAlchemy (async), asyncpg
- **Database**: PostgreSQL 16 + pgvector
- **AI**: Gemini / OpenAI / Ollama (embeddings + LLM using direct REST API)
- **Clustering**: scikit-learn (Agglomerative)
- **MCP**: FastMCP (streamable HTTP)
- **Frontend**: React, Vite, TailwindCSS v4
- **Extension**: Chrome Manifest V3
