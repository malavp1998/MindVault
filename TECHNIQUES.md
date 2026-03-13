# 🧪 MindVault — ML Techniques & Optimizations

> This document tracks all machine learning and AI engineering techniques
> applied to MindVault to improve performance, accuracy, cost efficiency,
> and user experience. Each technique includes motivation, implementation
> details, tradeoffs, and measured or expected impact.

---

## Table of Contents

1. [Semantic Caching](#1-semantic-caching)
2. [Incremental HDBSCAN Clustering](#2-incremental-hdbscan-clustering)
3. [Structured Prompting (XML + JSON Schema)](#3-structured-prompting-xml--json-schema)
4. [Optimistic Inserts for TOCTOU Race Conditions](#4-optimistic-inserts-for-toctou-race-conditions)
5. *(more techniques will be added as they are implemented)*

---

## 1. Semantic Caching

### Motivation

MindVault makes LLM API calls for every note saved and every search
or chat query. On free tier APIs this creates two problems:

- Rate limits hit quickly with moderate usage
- Repeated or similar queries waste API calls unnecessarily

Traditional exact-match caching (Redis key-value) only helps when
queries are byte-for-byte identical. In natural language this almost
never happens:
```text
"what are transformers?"
"explain transformers"
"tell me about transformer models"
```

All three queries have the same intent but would all miss an
exact-match cache. Semantic caching solves this by matching on
meaning rather than string equality.

---

### What It Is

Semantic caching stores LLM responses alongside vector embeddings
of the input query. On each new request the query is embedded and
compared against cached embeddings using cosine similarity. If a
sufficiently similar cached query is found the stored response is
returned directly without calling the LLM.
```text
New query arrives
        ↓
Embed query → 1024-dim vector via Jina AI
        ↓
pgvector cosine similarity search against semantic_cache table
        ↓
similarity >= threshold (0.92)?
        ↓ YES                        ↓ NO
return cached response           call LLM API
increment hit_count              store response + embedding in cache
        ↓                            ↓
        └────────────┬───────────────┘
                     ↓
              return response to user
```

---

### Implementation Details

#### Storage

Responses are stored in a `semantic_cache` table in PostgreSQL
with a `vector(1024)` column powered by pgvector. HNSW index is
used for fast approximate nearest neighbor search even as the
cache grows large.
```sql
CREATE TABLE semantic_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key VARCHAR(100) NOT NULL,
    query_text TEXT NOT NULL,
    query_embedding vector(1024),
    response TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    hit_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX ON semantic_cache
USING hnsw (query_embedding vector_cosine_ops);

CREATE INDEX ON semantic_cache(cache_key, user_id);
CREATE INDEX ON semantic_cache(expires_at);
```

#### Similarity Threshold

The threshold of 0.92 cosine similarity was chosen to balance
precision vs recall:

| Threshold | Behavior                                            |
|-----------|-----------------------------------------------------|
| 0.95+     | Very strict — only near exact matches hit cache     |
| 0.92      | Recommended — catches rephrasing and paraphrasing   |
| 0.88      | Aggressive — higher hit rate but risks wrong responses |
| 0.85      | Too loose — unacceptable wrong response rate        |

#### Cache Scoping

Two scopes are used depending on the operation:

- **Global cache** `(user_id = NULL)` — used for summarization and
  tag generation where the same content produces the same output
  regardless of which user saved it

- **Personal cache** `(user_id = set)` — used for RAG search and
  chat where responses are grounded in that user's specific vault

#### TTL Strategy

Different operations have different cache lifetimes based on how
frequently the underlying data changes:

| Operation      | TTL      | Reasoning                        |
|----------------|----------|----------------------------------|
| Note summary   | 24 hours | Article content is stable        |
| Tag generation | 48 hours | Tags rarely need to change       |
| Topic naming   | 72 hours | Cluster names are very stable    |
| RAG search     | 6 hours  | User vault grows frequently      |
| Chat response  | 1 hour   | Conversational context changes   |

#### Cache Invalidation

When a user saves a new note their personal RAG and chat cache is
invalidated immediately because the vault has new content and
previously cached answers may now be incomplete or stale.
```python
async def process_note(note_id: str):
    # ... process note ...

    # invalidate personal cache — vault content has changed
    await invalidate_user_cache(user_id, cache_key="rag")
    await invalidate_user_cache(user_id, cache_key="chat")
```

#### Scheduled Cleanup

Expired cache entries are deleted on startup and every hour via
APScheduler to prevent unbounded table growth.
```python
scheduler.add_job(
    cleanup_expired_cache,
    "interval",
    hours=1,
    id="cache_cleanup"
)
```

---

### Where It Is Applied

| LLM Function                         | Cache Key  | Scope    | TTL  |
|---------------------------------------|------------|----------|------|
| summarize_note()                      | summary    | global   | 24h  |
| generate_tags()                       | tags       | global   | 48h  |
| generate_topic_name()                 | topic_name | global   | 72h  |
| rag_answer()                          | rag        | per user | 6h   |
| chat_with_vault() first message only  | chat       | per user | 1h   |

Chat caching is only applied to the first message in a session.
Multi-turn messages have prior conversation context which makes
caching unreliable — the same question in different conversation
contexts should produce different answers.

---

### Tradeoffs

**Pros:**
- Reduces LLM API calls by estimated 40-60% for moderate usage
- Effectively extends free tier rate limits significantly
- Sub-millisecond cache lookup via HNSW index
- No external dependency — reuses existing pgvector infrastructure
- Transparent to all callers — zero changes needed in routes

**Cons:**
- Embedding every cache lookup adds one Jina API call per request
  (mitigated by Jina's 1M free token budget)
- Cache table grows over time (mitigated by TTL scheduled cleanup)
- 0.92 threshold may occasionally return a slightly off response
  for edge cases near the similarity boundary
- First-time queries always miss cache — no cold start benefit

---

### Expected Impact

For a personal knowledge vault with moderate usage
(50-100 notes, 20-30 queries per day):
```text
Without semantic cache:
~80-120 LLM API calls/day

With semantic cache (estimated 40-60% hit rate):
~32-72 LLM API calls/day

Groq 70b limit:   1000 req/day → effectively lasts 2-3x longer
Gemini limit:     1500 req/day → effectively lasts 2-3x longer
Jina embeddings:  1M tokens   → ~10,000 cache lookups per token budget
```

---

### Monitoring

Cache performance can be tracked via the stats endpoint:
```text
GET /api/cache/stats
```

Example response:
```json
{
  "total_entries": 142,
  "total_hits": 89,
  "avg_hits_per_entry": 0.63,
  "global_entries": 98,
  "personal_entries": 44,
  "summary_entries": 61,
  "tag_entries": 37,
  "rag_entries": 31,
  "chat_entries": 13,
  "active_entries": 138,
  "expired_entries": 4,
  "estimated_api_calls_saved": 89,
  "cache_hit_rate": 38.5
}
```

## 2. Incremental HDBSCAN Clustering

### Motivation

Previously, every new note saved triggered a full UMAP → HDBSCAN → UMAP-2D
pipeline run on all notes. With a growing vault this became progressively
slower (8–15s for 200+ notes) and wasted compute on notes whose clusters
hadn't changed at all.

HDBSCAN supports `approximate_predict()` for assigning new points to an
already-fitted model — making per-note incremental assignment possible.

---

### What It Is

A two-path strategy that separates cheap per-note assignment from expensive
periodic retraining:
```text
New note saved
        ↓
Warm cache exists? (fitted UMAP + HDBSCAN model in memory)
        ↓ YES                             ↓ NO
approximate_predict on new embedding    full cluster_notes() run
transform via cached UMAP reducers      caches fitted model after run
write topic_id + graph coords           ← same result, slower path
        ↓
notes_since_full_cluster counter++
        ↓
counter >= 20?
        ↓ YES
also trigger full cluster_notes()       ← refresh model in background
reset counter
```

---

### Implementation Details

Three globals are cached after each full run in `clustering.py`:
- `_fitted_clusterer` — the trained HDBSCAN model
- `_fitted_reducer_cluster` — high-dim UMAP for cluster space
- `_fitted_reducer_2d` — 2D UMAP for graph layout coordinates

`assign_new_note_incremental()` uses these to place a new note in ~50–200ms
without touching other notes. On the 20th new note, a full recluster is
also fired as a background task to keep the model accurate over time.

---

### Where It Is Applied

| File | Change |
|---|---|
| `backend/services/clustering.py` | Added `_fitted_reducer_2d` cache, `assign_new_note_incremental()` |
| `backend/routes/notes.py` | Per-note save now calls incremental path; full recluster every 20 notes |

---

### Tradeoffs

**Pros:**
- Per-note assignment drops from ~8–15s to ~50–200ms
- Full pipeline still runs periodically to prevent cluster drift
- Falls back to full recluster automatically on cold cache (server restart)

**Cons:**
- Module-level model cache is lost on server restart (first note triggers full run)
- `approximate_predict` may misclassify notes near cluster boundaries
- Outlier notes (label = -1) accumulate until the next full recluster

---

### Expected Impact

| Scenario | Before | After |
|---|---|---|
| New note (warm cache, 200 notes) | ~8–15s full pipeline | ~50–200ms incremental |
| Every 20th note | ~8–15s | ~8–15s + instant assignment |
| Cold cache / server restart | ~8–15s | ~8–15s (same) |

---

### References

- Lewis et al. (2020) — Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks
- pgvector HNSW indexing — github.com/pgvector/pgvector
- Bang et al. (2023) — GPTCache: A Data or Model Infrastructure for LLM-based Applications

---

## 3. Structured Prompting (XML + JSON Schema)

### Motivation

Previously, MindVault relied on free-text prompts that asked the LLM to return comma-separated lists, numbered bullet points, or raw strings (e.g., for tags, summaries, and synthesized answers). This caused several issues:

- **Fragile Parsing:** Regex or string splitting logic often broke when the LLM added conversational filler (e.g., "Here are your tags:") or markdown formatting.
- **Redundant LLM Calls:** Extracting a summary and extracting key concepts required two entirely separate LLM API calls on the same text.
- **Inconsistent Outputs:** The model sometimes missed constraints, failing to return the exact number of required items.

---

### What It Is

Structured Prompting enforces strict, predictable outputs by:
1. Using XML-like tags (`<role>`, `<task>`, `<schema>`, `<rules>`, `<content>`) to strictly demarcate instructions from user data, preventing prompt injection and context confusion.
2. Demanding exactly one machine-parseable JSON object/array as the final Output.
3. Consolidating multiple extractions (e.g., TL;DR + Concepts + Insights) into a single LLM call that returns a combined JSON payload.

---

### Implementation Details

#### Prompt Structure
Every prompt is standardized using an XML-style layout to explicitly define the schema:
```python
prompt = f\"\"\"<role>You are a precise metadata tagging engine.</role>

<task>Extract 3-5 tags into a structured JSON array.</task>

<schema>
["tag1", "tag2", "tag3"]
</schema>

<rules>
- Return ONLY the JSON array, no preamble or explanation.
- Lowercase, no punctuation.
</rules>

<example>
Input: "..."
Output: ["...", "..."]
</example>

<note>{content}</note>

Output:\"\"\"
```

#### Parsing Logic
A robust parsing shim uses `json.loads()`, stripping out accidental markdown fences:
```python
raw = await llm_complete(prompt)
try:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = "\\n".join(cleaned.split("\\n")[1:-1])
    parsed_json = json.loads(cleaned)
except (json.JSONDecodeError, ValueError):
    # Fallback to safe defaults
    parsed_json = fallback_value
```

---

### Where It Is Applied

| Feature | File | Improvement |
|---------|------|-------------|
| **Note Summary** | `services/llm.py` | `generate_summary` returns `{"tldr": "...", "key_concepts": [...]}` |
| **Concept Extraction** | `services/pipeline.py` | Removed the standalone `extract_concepts` LLM call; pipeline now parses concepts directly from the single summary output |
| **RAG QA** | `services/llm.py`, `agent.py` | `synthesize_answer` & `synthesize_node` return structured `answer`, `cited_source_ids`, and `confidence` |
| **Tagging** | `services/tagging.py` | `generate_tags` returns a pure JSON array `["tag1", "tag2"]` |
| **Agentic Chat** | `services/agentic_chat.py` | `classify_intent` returns `{"primary": "READ\|WRITE", "confidence": "high"}` |

---

### Tradeoffs

**Pros:**
- **Cost & Latency Reduction:** Eliminating the secondary concept extraction call cuts LLM usage by ~50% per note ingestion.
- **Reliability:** Almost 100% deterministic parsing using standard JSON.
- **Extensibility:** Makes it trivial to add new metadata fields (like confidence scores or source attribution) without writing fragile new regexes.

**Cons:**
- **Token Overhead:** Defining the JSON schema and rules adds a small token overhead to both the input prompt and output completion.
- **Model Requirements:** Generating perfectly formatted JSON consistently requires a capable LLM (like Llama 3 70B, GPT-4, or equivalent); weaker models may mangle the syntax.

---

### Expected Impact

- **Latency:** Reduces note ingestion pipeline time by 1–3 seconds due to consolidating two LLM calls into one.
- **API Costs:** Effectively halves the token usage specifically for processing newly saved notes.
- **Stability:** Removes edge-case bugs triggered by LLM conversational preamble or formatting quirks.

---

## 4. Optimistic Inserts for TOCTOU Race Conditions

### Motivation

During initial user login, the application auto-provisions a new `User` record if one does not exist for the provided Firebase UID. When a fresh user logs into the frontend, the web app fires several concurrent background requests instantly (e.g., fetching notes, topics, stats, queue). 

Because the user does not exist yet, multiple concurrent requests reach the provisioning logic at exactly the same millisecond. 

### What It Is

A **Time-Of-Check-Time-Of-Use (TOCTOU)** race condition occurs when an application checks if a resource is available, and then acts assuming it still is. 

```python
# Before (Vulnerable to TOCTOU)
if not user_exists():  <-- Multiple concurrent requests pass this check simultaneously
    insert_user()      <-- The first request succeeds; all subsequent ones crash with UniqueViolationError
```

Application-level `while True` loops or uniqueness checks cannot solve this in an async environment. You have two choices:
1. Distributed application-level locks (e.g., Redis).
2. **Optimistic Inserts** relying on Database Constraints.

MindVault uses **Optimistic Inserts**. We allow the concurrent workers to blindly attempt the `INSERT` simultaneously. We rely entirely on the PostgreSQL database to enforce the Unique Constraint and throw an `IntegrityError` to the "losing" workers.

### Implementation Details

When the "losing" concurrent requests catch the `IntegrityError` from the database, they do not crash. Instead, they gracefully roll back their failed transaction, and immediately run a `SELECT` query to fetch the row that the "winning" transaction just successfully inserted.

```python
try:
    user = User(firebase_uid=firebase_uid, username=username)
    db.add(user)
    await db.flush()  # The winner completes this, the losers throw IntegrityError here
except IntegrityError:
    # Race condition caught: another concurrent request inserted this user first.
    # Roll back the failed transaction to keep connection healthy, and fetch the winner's row.
    await db.rollback()
    result = await db.execute(select(User).where(User.firebase_uid == firebase_uid))
    user = result.scalar_one()
```

### Where It Is Applied

| Feature | File | Improvement |
|---------|------|-------------|
| **Auth Provisioning** | `middleware/auth.py` | Overhauled the `get_current_user` auto-provisioning block to use optimistic inserts instead of blind sequential inserts. |

### Tradeoffs

**Pros:**
- **Zero Configuration:** Does not require complex Redis distributed locking infrastructure.
- **Fast:** The "happy path" (which covers 99.9% of all subsequent requests for a user) avoids the latency of requesting and releasing application-level locks entirely.
- **ACID Compliant:** Relies on the rock-solid ACID properties of Postgres instead of finicky Python async state.

**Cons:**
- **Database Load:** Technically causes PostgreSQL to execute and immediately discard a transaction, slightly increasing DB log volume during the brief collision window.

### Expected Impact

- Completely eliminates `500 Internal Server Error` API failures during initial user onboarding and across multiple device logins simultaneously.

---

## How to Add a New Technique
