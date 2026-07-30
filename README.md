# 🧠 MindVault — AI-Powered Knowledge Management System

![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688?style=flat&logo=fastapi) ![React](https://img.shields.io/badge/React-18-61DAFB?style=flat&logo=react) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?style=flat&logo=postgresql) ![pgvector](https://img.shields.io/badge/pgvector-0.7-4169E1?style=flat) ![License](https://img.shields.io/badge/license-MIT-green?style=flat)

> MindVault is an AI-powered knowledge management system that automatically captures, summarizes, tags, and semantically links everything you read — like Obsidian meets RAG meets getrecall.ai

### 🌐 Live Demo

| | URL |
|---|---|https://mind-vault-4fwjzkhhe-piyush-malav-s-projects.vercel.app
| **Dashboard** | [https://mind-vault-4fwjzkhhe-piyush-malav-s-projects.vercel.app) |
| **Backend API** | [mindvault-wspy.onrender.com/docs](https://mindvault-sfny.onrender.com//docs) |
| **Chrome Extension** | [Chrome Web Store](https://chrome.google.com/webstore) *(pending review)* |

---

## 📸 Screenshots

### Your Vault — Dashboard

![Dashboard](screenshots/dashboard.png)

*Dark-themed masonry grid showing 50 saved notes with AI-generated summaries, auto tags, topic badges, memory retention scores, and language detection.*

### Note Detail — AI Summary, Tags & Actions

![Note Detail](screenshots/note_detail.png)

*Full note view with AI-generated summary, auto-tagged key concepts, custom tags, Reprocess/Edit/Delete actions, and source link.*

### Semantic Search + Hybrid Retrieval

![Search](screenshots/search_rag.png)

*Natural language search powered by hybrid Vector + BM25 + RRF fusion. Returns semantically matched notes with similarity scores and optional RAG synthesis.*

### Knowledge Graph — Obsidian-Style Topic Visualization

![Topics Graph](screenshots/topics_graph.png)

*Interactive force-directed graph. Topic clusters with semantic similarity edges, configurable threshold slider, and graph depth controls.*

### Daily Revision — Spaced Repetition

![Revision](screenshots/revision.png)

*Spaced repetition review queue. "Reveal Summary" flashcard-style interface with progress tracking and memory retention scoring.*

### API Documentation — Swagger UI

![API Docs](screenshots/api_docs.png)

*Auto-generated interactive API docs via FastAPI. All endpoints for auth, notes, topics, graph, chat, eval, and health checks.*

---

## ✨ Features

- 🧠 **Auto Summarization** — Every saved note gets a 3-sentence TL;DR and key concepts extracted automatically via LLM
- 🏷️ **Intelligent Auto-Tagging** — LLM generates 3-5 relevant tags per note. User can approve, reject, or add custom tags manually
- 🗂️ **Self-Organizing Topics** — Notes automatically cluster into topics using KMeans on embeddings. Topics regenerate silently after every new note saved
- 🔍 **Semantic Search + RAG** — Natural language search powered by pgvector cosine similarity. Returns a synthesized answer with cited source note cards
- 🌐 **Chrome Extension** — Popup-based extension to save any webpage, add annotations/tags, search your vault, and view related notes. No sidebar injection — works via toolbar icon click
- 💬 **AI Chat** — Chat with your vault. Ask questions and get answers grounded in your saved notes with full conversation history
- 🔐 **Authentication** — JWT-based auth with login/register. Per-user data isolation — each user sees only their own notes
- ⚡ **Semantic Cache** — LLM responses cached by semantic similarity. Repeated or similar queries return instantly without API calls
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
    [If synthesize=true] Notes used as context for LLM answer
            ↓
    LLM synthesizes answer grounded in YOUR notes only
            ↓
    Response returned with cited source note cards

    [If synthesize=false] Direct vector results returned instantly (no LLM)
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
lingua detects language (more accurate than langdetect)
        ↓
    ┌──────────────────────────────────┐
    │  Indic? (hi/ta/te/kn/bn/ml/gu)  │
    └──────────┬───────────────────────┘
               │ Yes                   │ No
               ▼                       ▼
    Gemini gemini-1.5-flash     Groq llama-3.3-70b-versatile
               ↓ rate limited          ↓ rate limited
    Sarvam sarvam-2b            Groq llama-3.1-8b-instant
               ↓ also fails
    Groq llama-3.1-8b-instant (last resort)
               │                       │
               └───────────┬───────────┘
                            ▼
               Jina AI jina-embeddings-v3
               (multilingual, all paths)
```

### LLM Fallback Chain

MindVault never breaks when a free tier limit is hit.
Every LLM call has an automatic fallback:

```
English content
        ↓
Groq llama-3.3-70b-versatile  ← best quality, 1000 req/day
        ↓ 429 rate limited
Groq llama-3.1-8b-instant     ← faster, 6000 req/day

Indic content (Hindi, Telugu, Tamil etc.)
        ↓
Gemini gemini-1.5-flash       ← best Hindi quality, 1500 req/day
        ↓ 429 rate limited
Sarvam sarvam-2b              ← Indic specialist fallback
        ↓ also rate limited
Groq llama-3.1-8b-instant     ← last resort, handles Hindi decently
```

All fallback switching is automatic — no user action needed.
App continues working even when multiple free tier limits are hit simultaneously.

---

## 🛠️ Tech Stack

| Layer                | Technology                        | Purpose                              |
|----------------------|-----------------------------------|--------------------------------------|
| Backend Framework    | FastAPI async                     | REST API + MCP server                |
| Database             | PostgreSQL 16                     | Note and topic storage               |
| Vector Search        | pgvector 0.7                      | Cosine similarity search             |
| ORM                  | SQLAlchemy async + asyncpg        | Database access layer                |
| LLM English (primary)| Groq `llama-3.3-70b-versatile`    | Summarization, tagging, RAG — best quality |
| LLM English (fallback)| Groq `llama-3.1-8b-instant`      | Auto fallback when 70b limit hits    |
| LLM Indic (primary)  | Gemini `gemini-1.5-flash`         | Hindi/Tamil/Telugu — best Indic quality |
| LLM Indic (fallback) | Sarvam AI `sarvam-2b`             | Auto fallback when Gemini limit hits |
| Embeddings           | Jina AI `jina-embeddings-v3`      | Multilingual vector embeddings       |
| Transcription        | Groq `whisper-large-v3-turbo`     | YouTube audio transcription          |
| Clustering           | scikit-learn KMeans               | Auto topic organization              |
| Language Detection   | lingua                            | Route content to right LLM           |
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
| Groq     | [console.groq.com](https://console.groq.com)                 | LLM English (70b + 8b) + Whisper transcription |
| Gemini   | [aistudio.google.com](https://aistudio.google.com)           | LLM Indic primary (Hindi, Telugu, Tamil) |
| Jina AI  | [jina.ai](https://jina.ai)                                   | Embeddings — 1M free tokens  |
| Sarvam AI| [dashboard.sarvam.ai](https://dashboard.sarvam.ai)           | LLM Indic fallback only      |

### Step 2 — Clone and Configure

```bash
git clone https://github.com/jitenderss/MindVault.git
cd MindVault
cp .env.example .env
# Fill in your API keys in .env
```

Fill in your `.env`:

```env
APP_ENV=local
GROQ_API_KEY=your_groq_key
JINA_API_KEY=your_jina_key
SARVAM_API_KEY=your_sarvam_key
DATABASE_URL=postgresql+asyncpg://mindvault:your_secure_password@localhost:5432/mindvault
```

### Step 3 — Run the Application

#### Option A — Docker (Recommended) 🐳

One command starts the **entire stack** (Postgres + Backend + Frontend):

```bash
make up
# OR directly:
docker compose up --build
```

> To run in background: `make up-detach`

Wait for:

```
✅ Database ready
✅ pgvector extension loaded
✅ MindVault API running on http://localhost:8000
✅ Frontend running on http://localhost:5173
```

| Service    | URL                                                          |
|------------|--------------------------------------------------------------|
| Frontend   | [http://localhost:5173](http://localhost:5173)                |
| Backend API| [http://localhost:8000/docs](http://localhost:8000/docs)      |
| PostgreSQL | `localhost:5432`                                             |

#### Option B — Local Development (without Docker)

If you prefer running services individually, open **two terminals**:

```bash
# Terminal 1 — Backend
make install-backend   # first time only
make dev-backend
# runs: cd backend && uvicorn main:app --reload --port 8000

# Terminal 2 — Frontend
make install-frontend  # first time only
make dev-frontend
# runs: cd frontend && npm run dev
```

> **Note:** You'll need a PostgreSQL 16 instance with pgvector running separately on port `5432`.

#### Useful Commands

| Command          | Description                    |
|------------------|--------------------------------|
| `make up`        | Start full stack (foreground) and sync extension |
| `make up-detach` | Start full stack (background)  |
| `make down`      | Stop all containers            |
| `make sync-ext`  | Sync extension URLs to current APP_ENV |
| `make logs`      | View backend logs              |
| `make shell-db`  | Open a psql shell              |
| `make test-smoke`| Run smoke tests                |

### Step 4 — Load Chrome Extension

1. Go to `chrome://extensions` in Chrome
2. Toggle **Developer mode** ON (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Pin the MindVault icon to your toolbar

> **Note:** The extension environment is entirely controlled by `APP_ENV` (either `local` or `production`) in your `.env` file. Running `make up` or `make sync-ext` automatically configures the extension's URLs for you.

### Step 5 — Connect Claude Desktop (optional)

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

## ☁️ Production Deployment

Deploy the full stack using **100% free tiers** — no credit card needed.

| Layer | Service | Free Limit |
|---|---|---|
| **Database** | [Neon](https://neon.tech) (PostgreSQL + pgvector) | 512 MB storage |
| **Backend** | [Render](https://render.com) (Docker) | 512 MB RAM, sleeps after 15min idle |
| **Frontend** | [Vercel](https://vercel.com) (Vite/React) | Unlimited deploys |
| **Extension** | Chrome Web Store | $5 one-time developer fee |

### Database — Neon

1. Sign up at [neon.tech](https://neon.tech)
2. Create project → copy connection string
3. Run `CREATE EXTENSION IF NOT EXISTS vector;` in SQL editor
4. Convert URL: `postgresql://` → `postgresql+asyncpg://`

> **Important:** asyncpg doesn't support `?sslmode=require` query params. MindVault's `database.py` auto-strips these and passes `ssl=True` via `connect_args`.

### Backend — Render

1. Sign up at [render.com](https://render.com) → New Web Service → connect GitHub
2. Set **Root Directory** to `backend`, **Runtime** to Docker
3. Add all environment variables from `.env` (use Neon URL for `DATABASE_URL`)
4. Deploy — tables auto-create on startup via `init_db()`

### Frontend — Vercel

1. Sign up at [vercel.com](https://vercel.com) → Import GitHub repo
2. Set **Root Directory** to `frontend`, **Framework** to `Vite`
3. Add env var: `VITE_API_URL` = `https://your-app.onrender.com`
4. Deploy

The frontend uses `VITE_API_URL` to route API calls to the Render backend in production. Locally it falls back to `/api` which Vite proxies to Docker.

### Chrome Extension

1. Ensure your `.env` file has `APP_ENV=production` set.
2. Run `make sync-ext` from the terminal. This automatically points your `background.js` and `popup.js` to the live `PROD_FRONTEND_URL` and `PROD_BACKEND_URL` from your `.env` file.
3. Zip the `extension/` folder → upload to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
4. Category: **Productivity**

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

1. Open dashboard at [localhost:5173](http://localhost:5173) (or your Vercel URL)
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
| `POST`   | `/auth/register`              | Register a new user                  |
| `POST`   | `/auth/login`                 | Login and get JWT token              |
| `GET`    | `/auth/me`                    | Get current user info                |
| `POST`   | `/api/notes`                  | Create a new note                    |
| `GET`    | `/api/notes`                  | List all notes (filterable)          |
| `GET`    | `/api/notes/search?q=`        | Semantic search + optional RAG       |
| `GET`    | `/api/notes/related?url=`     | Find related notes by URL            |
| `GET`    | `/api/notes/{id}`             | Get note with backlinks              |
| `POST`   | `/api/notes/{id}/process`     | Trigger AI processing                |
| `PATCH`  | `/api/notes/{id}/tags`        | Update user tags                     |
| `POST`   | `/api/notes/{id}/suggest-tags`| AI tag suggestions                   |
| `DELETE` | `/api/notes/{id}`             | Delete a note                        |
| `POST`   | `/api/notes/youtube`          | Summarize + save YouTube video       |
| `GET`    | `/api/topics`                 | List topic clusters                  |
| `GET`    | `/api/topics/{id}`            | Get topic with notes                 |
| `POST`   | `/api/topics/recluster`       | Trigger KMeans re-clustering         |
| `POST`   | `/api/topics/{id}/summarize`  | AI topic summary                     |
| `GET`    | `/api/graph/data`             | Graph nodes + links for graph view   |
| `POST`   | `/api/chat`                   | Chat with your vault (RAG)           |
| `GET`    | `/api/chat/sessions`          | List chat sessions                   |
| `GET`    | `/api/cache/stats`            | Semantic cache statistics            |
| `GET`    | `/health`                     | Health check                         |

---

## 🤖 MCP Tools

| Tool                                          | Description                          |
|-----------------------------------------------|--------------------------------------|
| `search_vault(query, user_id)`                | Semantic search across user's notes  |
| `add_note(content, user_id, title, source)`   | Save and process a new note          |
| `get_related(note_id, user_id)`               | Get linked notes                     |
| `list_topics(user_id)`                        | List user's topic clusters           |
| `summarize_topic(topic_id, user_id)`          | Generate topic summary               |
| `chat_with_vault(message, user_id)`           | Native Q&A via LangGraph RAG agent   |
| `get_due_reviews(user_id)`                    | Fetch daily spaced-repetition queue  |

### Example Claude Desktop Interactions

```
You: Search my vault for transformer architecture notes
Claude: [calls search_vault("transformer architecture")]
        Found 4 relevant notes. Here is a synthesis...

You: What topics have I been studying lately?
Claude: [calls list_topics()]
        You have 6 topic clusters: Deep Learning (12 notes),
        Python Development (8 notes), System Design (5 notes)...

You: Ask MindVault: what are the key differences between SQL and NoSQL based on my notes?
Claude: [calls chat_with_vault("what are the key differences between SQL and NoSQL...")]
        Based on your notes, SQL databases are relational...

You: Fetch my due reviews from MindVault and quiz me on the first one.
Claude: [calls get_due_reviews()]
        You have 5 notes due today. Let's start with 'System Design'. What is...
```

---

## 🌍 Environment Variables

| Variable               | Default                                               | Description                              |
|------------------------|-------------------------------------------------------|------------------------------------------|
| `APP_ENV`              | `local`                                               | Controls whether the frontend and extension use local Docker URLs or live Production URLs |
| `PROD_BACKEND_URL`     | —                                                     | Production API base used when APP_ENV=production |
| `PROD_FRONTEND_URL`    | —                                                     | Production Dashboard base used when APP_ENV=production |
| `GROQ_API_KEY`         | —                                                     | Groq API key for LLM and Whisper         |
| `LLM_ENGLISH_PRIMARY`  | `llama-3.3-70b-versatile`                             | Primary English model on Groq            |
| `LLM_ENGLISH_FALLBACK` | `llama-3.1-8b-instant`                                | Fallback English model when primary limit hits |
| `GEMINI_API_KEY`       | —                                                     | Google AI Studio key for Indic LLM       |
| `LLM_INDIC_PRIMARY`    | `gemini-1.5-flash`                                    | Primary Indic language model             |
| `SARVAM_API_KEY`       | —                                                     | Sarvam AI key — used as Indic fallback only |
| `LLM_INDIC_FALLBACK`   | `sarvam-2b`                                           | Fallback Indic model when Gemini limit hits |
| `JINA_API_KEY`         | —                                                     | Jina AI key for embeddings               |
| `DATABASE_URL`         | `postgresql+asyncpg://mindvault:your_secure_password@localhost:5432/mindvault` | PostgreSQL connection |
| `JWT_SECRET_KEY`       | —                                                     | Secret for JWT token generation          |
| `JWT_ALGORITHM`        | `HS256`                                               | JWT signing algorithm                    |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `10080`                                  | Token expiry (7 days default)            |
| `AUTH_METHOD`          | `credentials`                                         | Authentication method                    |
| `RECLUSTER_EVERY_N`    | every note                                            | Re-cluster on every new note saved       |
| `EMBEDDING_MODEL`      | `jina-embeddings-v3`                                  | Jina embedding model                     |
| `VITE_API_URL`         | —                                                     | Frontend env: production backend URL     |

---

## 💸 Free Tier Limits

All AI in MindVault runs on free APIs. For a personal knowledge vault these limits are more than sufficient. A typical note save uses 2–3 LLM calls and 1 embedding call.

| Service        | Model                     | Role             | Free Limit          | Resets    |
|----------------|---------------------------|------------------|---------------------|-----------|
| Groq           | `llama-3.3-70b-versatile` | English primary  | 1,000 req/day       | Daily     |
| Groq           | `llama-3.1-8b-instant`    | English fallback | 6,000 req/day       | Daily     |
| Gemini         | `gemini-1.5-flash`        | Indic primary    | 1,500 req/day       | Daily     |
| Sarvam AI      | `sarvam-2b`               | Indic fallback   | See dashboard       | —         |
| Groq           | `whisper-large-v3-turbo`  | Transcription    | 2 hours audio/day   | Daily     |
| Jina AI        | `jina-embeddings-v3`      | Embeddings       | 1M tokens           | One time  |

---

## 🎯 Skills Demonstrated

This project was built as a portfolio piece showcasing AI engineering skills:

| Skill                  | Where Used                                                                |
|------------------------|---------------------------------------------------------------------------|
| RAG                    | `/search` — pgvector retrieval + LLM synthesis with citations             |
| Vector Embeddings      | Jina AI embeddings stored in pgvector                                     |
| Semantic Search        | Cosine similarity via pgvector `<=>` operator                             |
| LLM Orchestration      | Smart routing with primary/fallback chain — Groq 70b + 8b for English, Gemini + Sarvam for Indic |
| Agentic Pipeline       | Async note processing pipeline triggered on every save                    |
| MCP Integration        | FastMCP server with 5 tools for Claude Desktop                            |
| Multilingual AI        | lingua detection + Groq, Gemini, and Sarvam routing with auto fallback    |
| Chrome Extension       | Manifest V3 popup-based extension (activeTab + scripting)                 |
| Authentication         | JWT-based auth with per-user data isolation                               |
| Semantic Caching       | LLM response caching by semantic similarity to reduce API calls           |
| Cloud Deployment       | Neon (DB) + Render (backend) + Vercel (frontend) — full free-tier stack   |
| Clustering & ML        | KMeans + silhouette scoring for auto topic detection                      |
| Graph Visualization    | Force-directed graph with react-force-graph-2d                            |
| Async Backend          | FastAPI + SQLAlchemy async + asyncpg                                      |
| Docker                 | Multi-service docker-compose setup                                        |

---

## 📁 Project Structure

```
mindvault/
├── backend/
│   ├── main.py                # FastAPI app entry + CORS + router registration
│   ├── config.py              # Pydantic settings (env vars)
│   ├── database.py            # Async SQLAlchemy + pgvector + SSL handling
│   ├── models.py              # Note, Topic, NoteLink, User, ChatSession ORM models
│   ├── schemas.py             # Request/response Pydantic schemas
│   ├── mcp_server.py          # MCP server (5 tools for Claude Desktop)
│   ├── Dockerfile             # Python 3.12 + ffmpeg production image
│   ├── routes/
│   │   ├── auth.py            # JWT auth — login, register, rate limiting
│   │   ├── notes.py           # Note CRUD + search + RAG + tag management
│   │   ├── topics.py          # Topic endpoints + recluster
│   │   ├── graph.py           # Graph data endpoint
│   │   ├── chat.py            # Chat with vault (multi-turn RAG)
│   │   └── cache.py           # Semantic cache stats endpoint
│   └── services/
│       ├── embedding.py       # Jina AI embeddings (padded to 1536d)
│       ├── llm.py             # Smart LLM routing + fallback chain
│       ├── agent.py           # RAG agent (LangGraph: search → synthesize)
│       ├── chat.py            # Chat service with conversation history
│       ├── semantic_cache.py  # Semantic similarity caching for LLM responses
│       ├── clustering.py      # KMeans + silhouette scoring
│       ├── tagging.py         # Auto-tag generation
│       ├── transcription.py   # Groq Whisper + yt-dlp
│       ├── language.py        # lingua-based language detection
│       └── pipeline.py        # AI processing orchestration
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Routes + navigation + auth guard
│   │   ├── api.js             # Axios API client (VITE_API_URL aware)
│   │   ├── index.css          # Design system (dark theme + TailwindCSS v4)
│   │   ├── context/
│   │   │   └── AuthContext.jsx # JWT auth state management
│   │   ├── components/
│   │   │   └── GraphView.jsx  # Obsidian-style force graph canvas
│   │   └── pages/
│   │       ├── LoginPage.jsx   # Login / Register page
│   │       ├── VaultPage.jsx   # Masonry note grid dashboard
│   │       ├── TopicsPage.jsx  # Interactive graph view + side panel
│   │       ├── NotePage.jsx    # Note detail + auto/user tags + backlinks
│   │       ├── SearchPage.jsx  # Semantic search + optional RAG answer
│   │       └── ChatPage.jsx    # Chat with your vault
│   ├── Dockerfile             # Node.js dev server image
│   └── package.json
├── extension/
│   ├── manifest.json          # Manifest V3 (activeTab + scripting)
│   ├── popup.html             # Extension popup UI
│   ├── popup.js               # Popup logic (save, search, related)
│   ├── popup.css              # Dark theme popup styles
│   ├── background.js          # Service worker (API calls)
│   └── lib/Readability.js     # Article content extraction
├── docker-compose.yml         # Full stack: postgres + backend + frontend
├── Makefile                   # Convenience commands
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
