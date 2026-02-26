# 🧠 MindVault — AI-Powered Knowledge Management System

![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688?style=flat&logo=fastapi) ![React](https://img.shields.io/badge/React-18-61DAFB?style=flat&logo=react) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?style=flat&logo=postgresql) ![pgvector](https://img.shields.io/badge/pgvector-0.7-4169E1?style=flat) ![License](https://img.shields.io/badge/license-MIT-green?style=flat)

> MindVault is an AI-powered knowledge management system that automatically captures, summarizes, tags, and semantically links everything you read — like Obsidian meets RAG meets getrecall.ai

---

## ✨ Features

- 🧠 **Auto Summarization** — Every saved note gets a 3-sentence TL;DR and key concepts extracted automatically via LLM
- 🏷️ **Intelligent Auto-Tagging** — LLM generates 3-5 relevant tags per note. User can approve, reject, or add custom tags manually
- 🗂️ **Self-Organizing Topics** — Notes automatically cluster into topics using KMeans on embeddings. Topics regenerate silently after every new note saved
- 🔍 **Semantic Search + RAG** — Natural language search powered by pgvector cosine similarity. Returns a synthesized answer with cited source note cards
- 🌐 **Chrome Extension** — Floating sidebar on any webpage to save content, add annotations, and see related notes from your vault inline while browsing
- 📺 **YouTube Summarizer** — Paste any YouTube URL. Fetches captions or transcribes audio via Groq Whisper API, then summarizes and saves as a note. Temp audio deleted immediately after transcription
- 🌍 **Multilingual Support** — Detects language automatically. Routes Indic language content (Hindi, Tamil, Telugu, Kannada etc.) to Sarvam AI, English to Groq LLM
- 🕸️ **Obsidian-Style Graph View** — Interactive force-directed graph showing topics as large purple nodes, notes as smaller nodes, connected by shared tags and topic membership. Hover to highlight, click to explore
- 🤖 **MCP Server** — Exposes 5 tools via Model Context Protocol so Claude Desktop or any MCP client can search, add, and explore your vault
- 🔗 **Backlinks** — Every note shows which other notes reference it, building a bidirectional knowledge graph automatically
- ☁️ **Zero Local AI** — All AI runs on free cloud APIs. No GPU, no heavy local models, no cost

---

## 🏗️ Architecture

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

### Note Processing Pipeline

```
User saves content (extension or dashboard)
            ↓
    Language Detection (langdetect)
            ↓
    ┌────────────────────────────────┐
    │  Parallel Processing           │
    │  1. LLM Summary generation     │
    │  2. Auto tag generation        │
    │  3. Jina embedding creation    │
    └────────────────────────────────┘
            ↓
    Store in PostgreSQL + pgvector
            ↓
    Background: KMeans re-clustering (asyncio.create_task)
            ↓
    Topics and backlinks updated silently
```

### RAG Search Flow

```
User types natural language query
            ↓
    Query embedded via Jina AI
            ↓
    pgvector finds top-5 similar notes (cosine similarity <=>)
            ↓
    Retrieved notes stuffed into LLM prompt as context
            ↓
    LLM synthesizes answer grounded in YOUR notes only
            ↓
    Response returned with cited source note cards
```

### YouTube Summarization Flow

```
User pastes YouTube URL
            ↓
    Try fetching captions (youtube-transcript-api)
            ↓ if no captions available
    yt-dlp downloads audio → system temp folder
            ↓
    Audio sent to Groq Whisper API (runs on their servers)
            ↓
    Temp audio file deleted immediately via finally block
            ↓
    Transcript flows into standard note processing pipeline
```

### Multilingual Routing

```
Content received
        ↓
langdetect identifies language
        ↓
    ┌──────────────────────────────────┐
    │  Indic? (hi/ta/te/kn/bn/ml/gu)  │
    └──────────┬───────────────────────┘
               │ Yes              │ No
               ▼                  ▼
        Sarvam AI            Groq LLM
        sarvam-2b       llama-3.1-8b-instant
               │                  │
               └────────┬─────────┘
                         ▼
              Jina AI Embeddings
              (multilingual, both paths)
```

---

## 🛠️ Tech Stack

| Layer                | Technology                        | Purpose                              |
|----------------------|-----------------------------------|--------------------------------------|
| Backend Framework    | FastAPI async                     | REST API + MCP server                |
| Database             | PostgreSQL 16                     | Note and topic storage               |
| Vector Search        | pgvector 0.7                      | Cosine similarity search             |
| ORM                  | SQLAlchemy async + asyncpg        | Database access layer                |
| LLM English          | Groq `llama-3.1-8b-instant`       | Summarization, tagging, RAG          |
| LLM Indic            | Sarvam AI `sarvam-2b`             | Hindi/Tamil/Telugu content           |
| Embeddings           | Jina AI `jina-embeddings-v3`      | Multilingual vector embeddings       |
| Transcription        | Groq `whisper-large-v3-turbo`     | YouTube audio transcription          |
| Clustering           | scikit-learn KMeans               | Auto topic organization              |
| Language Detection   | langdetect                        | Route content to right LLM           |
| MCP                  | FastMCP                           | Claude Desktop integration           |
| Frontend             | React 18 + Vite + TailwindCSS v4  | Dashboard UI                         |
| Graph View           | react-force-graph-2d + D3         | Obsidian-style knowledge graph       |
| Chrome Extension     | Manifest V3                       | Browser sidebar integration          |
| Audio Download       | yt-dlp + ffmpeg                   | YouTube audio extraction             |
| Content Parsing      | Readability.js                    | Clean article text from pages        |
| Containerization     | Docker + Docker Compose           | One-command local setup              |

---

## 🚀 Setup Guide

### Prerequisites

| Tool           | Version | Install                                   |
|----------------|---------|-------------------------------------------|
| Docker         | 24+     | [docker.com](https://docker.com)          |
| Docker Compose | 2.x     | Included with Docker Desktop              |
| Node.js        | 18+     | [nodejs.org](https://nodejs.org)          |
| Python         | 3.11+   | [python.org](https://python.org)          |
| ffmpeg         | any     | `brew install ffmpeg` / `apt install ffmpeg` |
| Chrome         | any     | For the browser extension                 |

### Step 1 — Get Free API Keys

All free tier, no credit card required:

| Service  | Get Key At                                                   | Used For                     |
|----------|--------------------------------------------------------------|------------------------------|
| Groq     | [console.groq.com](https://console.groq.com)                 | LLM + Whisper transcription  |
| Jina AI  | [jina.ai](https://jina.ai)                                   | Embeddings — 1M free tokens  |
| Sarvam AI| [dashboard.sarvam.ai](https://dashboard.sarvam.ai)           | Indic language LLM           |

### Step 2 — Clone and Configure

```bash
git clone https://github.com/jitenderss/MindVault.git
cd MindVault
cp .env.example .env
# Fill in your API keys in .env
```

Fill in your `.env`:

```env
GROQ_API_KEY=your_groq_key
JINA_API_KEY=your_jina_key
SARVAM_API_KEY=your_sarvam_key
DATABASE_URL=postgresql+asyncpg://***REMOVED***@localhost:5432/mindvault
```

### Step 3 — Start Backend and Database

```bash
docker compose up --build
```

Wait for:

```
✅ Database ready
✅ pgvector extension loaded
✅ MindVault API running on http://localhost:8000
```

Visit [http://localhost:8000/docs](http://localhost:8000/docs) for interactive API docs.

### Step 4 — Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Visit [http://localhost:5173](http://localhost:5173)

### Step 5 — Load Chrome Extension

1. Go to `chrome://extensions` in Chrome
2. Toggle **Developer mode** ON (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Pin the MindVault icon to your toolbar

### Step 6 — Connect Claude Desktop (optional)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mindvault": {
      "url": "http://localhost:8000/mcp"
    }
  }
}
```

Restart Claude Desktop. You can now ask Claude to search your vault, add notes, and summarize topics directly.

---

## 📖 Usage Guide

### Saving a Web Page

1. Browse to any webpage
2. Click the MindVault icon in your Chrome toolbar
3. Optionally select specific text or save the full page
4. Add a personal annotation (optional)
5. Click **Save to Vault**
6. Tags and summary appear automatically within seconds

### Saving a YouTube Video

1. Go to any YouTube video
2. Click the MindVault extension icon
3. Click **Summarize and Save Video**
4. MindVault fetches captions or transcribes via Groq Whisper
5. Structured summary saved to vault automatically
6. Temp audio file deleted immediately after transcription

### Searching Your Vault

1. Open dashboard at [localhost:5173](http://localhost:5173)
2. Go to `/search`
3. Ask in natural language: *"what did I learn about transformer attention mechanisms?"*
4. Get a synthesized RAG answer with cited source note cards

### Exploring the Knowledge Graph

1. Go to `/topics` in the dashboard
2. Force-directed graph loads with all topics and notes
3. **Large purple nodes** = topic clusters
4. **Small gray nodes** = individual notes
5. Hover a node to highlight all connections
6. Click a node to open the detail side panel
7. Scroll to zoom, drag to pan, right-click to open full note

### Using with Claude Desktop

Once MCP is connected you can tell Claude:

- *"Search my vault for notes about machine learning"*
- *"Add a note about today's meeting"*
- *"What topics do I have in my vault?"*
- *"Summarize my Deep Learning topic"*
- *"Find notes related to transformers"*

---

## 📡 API Reference

### `POST /api/notes`

Save a new note.

**Request:**

```json
{
  "content": "Transformers use self-attention to process sequences in parallel...",
  "title": "Attention is All You Need — Notes",
  "source_url": "https://arxiv.org/abs/1706.03762",
  "user_tags": ["nlp", "research"]
}
```

**Response:**

```json
{
  "id": "uuid",
  "title": "Attention is All You Need — Notes",
  "summary": "Transformers replace recurrence with self-attention mechanisms...",
  "auto_tags": ["transformers", "nlp", "attention mechanism"],
  "user_tags": ["nlp", "research"],
  "topic": "Deep Learning",
  "language": "en",
  "created_at": "2026-02-26T10:00:00Z"
}
```

### `GET /api/notes/search?q=transformers&rag=true`

Semantic search with RAG synthesized answer.

**Response:**

```json
{
  "answer": "Based on your notes, transformers work by replacing recurrence...",
  "sources": [
    { "id": "uuid", "title": "Attention is All You Need", "similarity": 0.92 },
    { "id": "uuid", "title": "BERT explained", "similarity": 0.87 }
  ]
}
```

### `POST /api/notes/youtube`

Summarize and save a YouTube video as a note.

**Request:**

```json
{
  "video_url": "https://youtube.com/watch?v=abc123",
  "annotation": "Watched for NLP course revision"
}
```

### `GET /api/graph/data`

Returns full node and link data for the Obsidian-style graph view.

**Response:**

```json
{
  "nodes": [
    { "id": "topic-1", "label": "Machine Learning", "type": "topic", "count": 12 },
    { "id": "note-abc", "label": "My Note Title", "type": "note", "tags": ["nlp"] }
  ],
  "links": [
    { "source": "topic-1", "target": "note-abc" },
    { "source": "note-abc", "target": "note-xyz", "shared_tag": "nlp" }
  ]
}
```

### All Endpoints

| Method   | Path                          | Description                          |
|----------|-------------------------------|--------------------------------------|
| `POST`   | `/api/notes`                  | Create a new note                    |
| `GET`    | `/api/notes`                  | List all notes (filterable)          |
| `GET`    | `/api/notes/search?q=`        | Semantic search + optional RAG       |
| `GET`    | `/api/notes/related?url=`     | Find related notes by URL            |
| `GET`    | `/api/notes/{id}`             | Get note with backlinks              |
| `POST`   | `/api/notes/{id}/process`     | Trigger AI processing                |
| `PATCH`  | `/api/notes/{id}/tags`        | Update user tags                     |
| `POST`   | `/api/notes/{id}/suggest-tags`| AI tag suggestions                   |
| `DELETE` | `/api/notes/{id}`             | Delete a note                        |
| `GET`    | `/api/topics`                 | List topic clusters                  |
| `GET`    | `/api/topics/{id}`            | Get topic with notes                 |
| `POST`   | `/api/topics/recluster`       | Trigger KMeans re-clustering         |
| `POST`   | `/api/topics/{id}/summarize`  | AI topic summary                     |
| `GET`    | `/api/graph/data`             | Graph nodes + links for graph view   |

---

## 🤖 MCP Tools

| Tool                          | Description                          |
|-------------------------------|--------------------------------------|
| `search_vault(query)`         | Semantic search across all notes     |
| `add_note(content, title, source)` | Save and process a new note     |
| `get_related(note_id)`        | Get linked notes                     |
| `list_topics()`               | List all topic clusters              |
| `summarize_topic(topic_id)`   | Generate topic summary               |

### Example Claude Desktop Interactions

```
You: Search my vault for transformer architecture notes
Claude: [calls search_vault("transformer architecture")]
        Found 4 relevant notes. Here is a synthesis...

You: What topics have I been studying lately?
Claude: [calls list_topics()]
        You have 6 topic clusters: Deep Learning (12 notes),
        Python Development (8 notes), System Design (5 notes)...

You: Summarize my Deep Learning topic
Claude: [calls summarize_topic("topic-uuid")]
        Your Deep Learning notes cover: attention mechanisms,
        backpropagation, transformer architecture...
```

---

## 🌍 Environment Variables

| Variable               | Default                                               | Description                              |
|------------------------|-------------------------------------------------------|------------------------------------------|
| `GROQ_API_KEY`         | —                                                     | Groq API key for LLM and Whisper         |
| `JINA_API_KEY`         | —                                                     | Jina AI key for embeddings               |
| `SARVAM_API_KEY`       | —                                                     | Sarvam AI key for Indic language LLM     |
| `DATABASE_URL`         | `postgresql+asyncpg://***REMOVED***@localhost:5432/mindvault` | PostgreSQL connection |
| `RECLUSTER_EVERY_N`    | every note                                            | Re-cluster on every new note saved       |
| `WHISPER_MODEL`        | `whisper-large-v3-turbo`                              | Groq Whisper model                       |
| `EMBEDDING_MODEL`      | `jina-embeddings-v3`                                  | Jina embedding model                     |
| `LLM_MODEL_EN`         | `llama-3.1-8b-instant`                                | Groq model for English content           |
| `LLM_MODEL_INDIC`      | `sarvam-2b`                                           | Sarvam model for Indic languages         |

---

## 💸 Free Tier Limits

All AI in MindVault runs on free APIs. For a personal knowledge vault these limits are more than sufficient. A typical note save uses 2–3 LLM calls and 1 embedding call.

| Service        | Model                     | Free Limit          | Resets    |
|----------------|---------------------------|---------------------|-----------|
| Groq LLM       | `llama-3.1-8b-instant`    | 6,000 req/day       | Daily     |
| Groq Whisper   | `whisper-large-v3-turbo`  | 2 hours audio/day   | Daily     |
| Sarvam AI      | `sarvam-2b`               | See dashboard       | —         |
| Jina Embeddings| `jina-embeddings-v3`      | 1M tokens           | One time  |

---

## 🎯 Skills Demonstrated

This project was built as a portfolio piece showcasing AI engineering skills:

| Skill                  | Where Used                                                                |
|------------------------|---------------------------------------------------------------------------|
| RAG                    | `/search` — pgvector retrieval + LLM synthesis with citations             |
| Vector Embeddings      | Jina AI embeddings stored in pgvector                                     |
| Semantic Search        | Cosine similarity via pgvector `<=>` operator                             |
| LLM Orchestration      | Summarization, tagging, RAG, topic naming                                 |
| Agentic Pipeline       | Async note processing pipeline triggered on every save                    |
| MCP Integration        | FastMCP server with 5 tools for Claude Desktop                            |
| Multilingual AI        | langdetect + Groq and Sarvam routing                                      |
| Chrome Extension       | Manifest V3 with content scripts and sidebar                              |
| Clustering & ML        | KMeans + silhouette scoring for auto topic detection                      |
| Graph Visualization    | Force-directed graph with react-force-graph-2d                            |
| Async Backend          | FastAPI + SQLAlchemy async + asyncpg                                      |
| Docker                 | Multi-service docker-compose setup                                        |

---

## 📁 Project Structure

```
mindvault/
├── backend/
│   ├── main.py                # FastAPI app entry + router registration
│   ├── config.py              # Pydantic settings
│   ├── database.py            # Async SQLAlchemy + pgvector setup
│   ├── models.py              # Note, Topic, NoteLink ORM models
│   ├── schemas.py             # Request/response Pydantic schemas
│   ├── mcp_server.py          # MCP server (5 tools)
│   ├── routes/
│   │   ├── notes.py           # Note CRUD + search + tag management
│   │   ├── topics.py          # Topic endpoints + recluster
│   │   └── graph.py           # Graph data endpoint
│   └── services/
│       ├── embedding.py       # Jina AI embeddings
│       ├── llm.py             # Groq + Sarvam LLM routing
│       ├── clustering.py      # KMeans + silhouette scoring
│       ├── tagging.py         # Auto-tag generation
│       ├── transcription.py   # Groq Whisper + yt-dlp
│       ├── language.py        # Language detection
│       └── pipeline.py        # AI processing orchestration
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Routes + navigation
│   │   ├── api.js             # Axios API client
│   │   ├── index.css          # Design system (dark theme)
│   │   ├── components/
│   │   │   └── GraphView.jsx  # Obsidian-style force graph canvas
│   │   └── pages/
│   │       ├── VaultPage.jsx   # Masonry note grid
│   │       ├── TopicsPage.jsx  # Interactive graph view + side panel
│   │       ├── NotePage.jsx    # Note detail + auto/user tags + backlinks
│   │       └── SearchPage.jsx  # Semantic search + RAG answer
│   └── package.json
├── extension/
│   ├── manifest.json          # Manifest V3
│   ├── content.js             # Sidebar injection + note saving
│   ├── background.js          # Service worker
│   ├── sidebar.css            # Dark theme sidebar styles
│   └── lib/Readability.js     # Article content extraction
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 🤝 Contributing

Pull requests are welcome. For major changes please open an issue first to discuss what you would like to change.

1. Fork the repo
2. Create your feature branch: `git checkout -b feature/AmazingFeature`
3. Commit your changes: `git commit -m 'Add AmazingFeature'`
4. Push to the branch: `git push origin feature/AmazingFeature`
5. Open a Pull Request

---

## 📄 License

MIT License — free to use for your own projects.

---

<p align="center">
  Built with ☕ and too many API calls by <a href="https://github.com/jitenderss">@jitenderss</a>
</p>
