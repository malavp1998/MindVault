from __future__ import annotations
"""LLM service — multilingual routing via Groq, Gemini, and Sarvam with smart fallback."""

import json
from openai import AsyncOpenAI
from langsmith.wrappers import wrap_openai
from langsmith import traceable
from config import get_settings
from services.language import detect_language, is_indic
from services.semantic_cache import get_cached_response, set_cached_response

settings = get_settings()

# ── CLIENTS ───────────────────────────────────────────

_groq_client: AsyncOpenAI | None = None
_gemini_client: AsyncOpenAI | None = None
_sarvam_client: AsyncOpenAI | None = None


def _get_groq_client() -> AsyncOpenAI:
    """Groq client for English LLM."""
    global _groq_client
    if _groq_client is None:
        _groq_client = wrap_openai(AsyncOpenAI(
            api_key=settings.groq_api_key,
            base_url="https://api.groq.com/openai/v1"
        ))
    return _groq_client


def _get_gemini_client() -> AsyncOpenAI:
    """Gemini client for Indic LLM (primary)."""
    global _gemini_client
    if _gemini_client is None:
        _gemini_client = wrap_openai(AsyncOpenAI(
            api_key=settings.gemini_api_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
        ))
    return _gemini_client


def _get_sarvam_client() -> AsyncOpenAI:
    """Sarvam client for Indic LLM (fallback)."""
    global _sarvam_client
    if _sarvam_client is None:
        _sarvam_client = wrap_openai(AsyncOpenAI(
            api_key=settings.sarvam_api_key,
            base_url="https://api.sarvam.ai/v1"
        ))
    return _sarvam_client


# ── CALLERS ───────────────────────────────────────────

@traceable(name="call_groq", tags=["llm", "groq"])
async def call_groq(prompt: str, model: str) -> str:
    client = _get_groq_client()
    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1000
    )
    return response.choices[0].message.content.strip()


@traceable(name="call_gemini", tags=["llm", "gemini"])
async def call_gemini(prompt: str, model: str) -> str:
    client = _get_gemini_client()
    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1000
    )
    return response.choices[0].message.content.strip()


@traceable(name="call_sarvam", tags=["llm", "sarvam"])
async def call_sarvam(prompt: str, model: str) -> str:
    client = _get_sarvam_client()
    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1000
    )
    return response.choices[0].message.content.strip()


# ── MAIN ROUTER WITH FALLBACK ─────────────────────────

@traceable(name="llm_complete", tags=["llm", "routing"])
async def llm_complete(prompt: str, lang: str | None = None, max_tokens: int = 1000) -> str:
    """Smart routing LLM completion with fallback on rate limits."""
    detected_lang = lang or detect_language(prompt)

    if is_indic(detected_lang):
        # Indic: Gemini primary → Sarvam fallback → Groq 8b last resort
        try:
            return await call_gemini(prompt, settings.llm_indic_primary)
        except Exception as e:
            if "quota" in str(e).lower() or "rate" in str(e).lower() or "429" in str(e):
                print(f"[LLM] Gemini rate limit hit, falling back to Sarvam")
                try:
                    return await call_sarvam(prompt, settings.llm_indic_fallback)
                except Exception as e2:
                    print(f"[LLM] Sarvam also failed: {e2}, using Groq 8b")
                    return await call_groq(prompt, settings.llm_english_fallback)
            raise e
    else:
        # English: Groq 70b primary → Groq 8b fallback
        try:
            return await call_groq(prompt, settings.llm_english_primary)
        except Exception as e:
            if "quota" in str(e).lower() or "rate" in str(e).lower() or "429" in str(e):
                print(f"[LLM] Groq 70b rate limit hit, falling back to 8b")
                return await call_groq(prompt, settings.llm_english_fallback)
            raise e


@traceable(name="llm_complete_with_history", tags=["llm", "chat", "routing"])
async def llm_complete_with_history(messages: list, lang: str | None = None) -> str:
    """Multi-turn LLM completion with full message history and fallback."""
    detected_lang = lang or "en"

    if is_indic(detected_lang):
        try:
            client = _get_gemini_client()
            response = await client.chat.completions.create(
                model=settings.llm_indic_primary, messages=messages, max_tokens=1000
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            if "quota" in str(e).lower() or "rate" in str(e).lower() or "429" in str(e):
                print(f"[LLM] Gemini rate limit, falling back to Sarvam for chat")
                try:
                    client = _get_sarvam_client()
                    response = await client.chat.completions.create(
                        model=settings.llm_indic_fallback, messages=messages, max_tokens=1000
                    )
                    return response.choices[0].message.content.strip()
                except Exception as e2:
                    print(f"[LLM] Sarvam also failed: {e2}, using Groq 8b for chat")
                    client = _get_groq_client()
                    response = await client.chat.completions.create(
                        model=settings.llm_english_fallback, messages=messages, max_tokens=1000
                    )
                    return response.choices[0].message.content.strip()
            raise e
    else:
        try:
            client = _get_groq_client()
            response = await client.chat.completions.create(
                model=settings.llm_english_primary, messages=messages, max_tokens=1000
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            if "quota" in str(e).lower() or "rate" in str(e).lower() or "429" in str(e):
                print(f"[LLM] Groq 70b rate limit, falling back to 8b for chat")
                client = _get_groq_client()
                response = await client.chat.completions.create(
                    model=settings.llm_english_fallback, messages=messages, max_tokens=1000
                )
                return response.choices[0].message.content.strip()
            raise e


# ── TASK SPECIFIC FUNCTIONS ───────────────────────────

@traceable(name="generate_summary", tags=["pipeline", "summarization"])
async def generate_summary(content: str, title: str = "", content_language: str | None = None) -> str:
    """Antigravity summary — no length limits, no sentence caps, full depth."""
    lang = content_language or detect_language(content)
    cache_query = content[:500]

    cached = await get_cached_response(cache_query, cache_key="summary")
    if cached:
        return cached

    title_block = f"<title>{title}</title>\n\n" if title else ""

    if is_indic(lang):
        summary_prompt = f"""<role>
Aap ek world-class knowledge analyst hain jo ek personal second brain ke liye kaam karte hain.
Aapka kaam hai content ko itne achhe se summarize karna ki user ko kabhi original padhna na pade.
</role>

<task>
Neeche diye content ka ek comprehensive, structured JSON summary banao.
Koi length limit NAHI hai. Jitna content demand kare, utna likho.
</task>

<schema>
{{
  "one_liner": "Ek crisp sentence — poora content ek line mein",
  "overview": "4-6 sentences — kya hai, main argument kya hai, kyun zaroori hai, aur kiske liye relevant hai",
  "detailed_summary": "Exactly 2 paragraphs. Paragraph 1: kya hai aur main argument. Paragraph 2: sabse important supporting detail ya nuance. Har paragraph 2-3 sentences. Paragraph 2 ke baad hard stop.",
  "key_concepts": ["concept1", "concept2", "concept3", "concept4", "concept5"],
  "insights": [
    "Koi non-obvious ya counterintuitive point jo content mein hai",
    "Ek concrete takeaway jo reader implement kar sake",
    "Kuch jo author implicitly kehta hai lekin directly nahi"
  ],
  "questions_raised": ["Ek interesting open question jo content uthata hai"],
  "best_quote": "Content ka sabse powerful sentence — verbatim, ya empty string agar koi nahi"
}}
</schema>

<rules>
- detailed_summary sabse important field hai — itna comprehensive hona chahiye ki reader ko original padhna na pade
- overview aur detailed_summary alag purposes serve karte hain — ek doosre ko replace mat karo
- insights sirf is content ke liye specific hone chahiye — generic advice nahi
- Return ONLY the JSON object — no markdown fences, no preamble, kuch bhi extra nahi
</rules>

{title_block}<content>{content[:12000]}</content>

Output:"""

    else:
        summary_prompt = f"""<role>
You are a world-class knowledge analyst working for a personal second brain.
Your mission: summarize content so thoroughly that the user never needs to read the original again.
You write like the smartest person in the room explaining something to a curious friend — precise, opinionated, genuinely useful.
</role>

<task>
Produce a comprehensive, structured JSON summary of the content below.
There is NO length limit. Write as much as the content demands.
A short article might need 200 words of detailed_summary. A dense paper might need 800. Match the depth.
</task>

<schema>
{{
  "one_liner": "One razor-sharp sentence that captures the entire content",
  "overview": "4-6 sentences covering: what this is, the central argument or finding, why it matters, and who it's most relevant for",
  "detailed_summary": "Exactly 2 paragraphs. Paragraph 1: what this is and the central argument. Paragraph 2: the most important supporting detail or nuance. Each paragraph 2-3 sentences. Hard stop after paragraph 2.",
  "key_concepts": ["5-8 specific concepts or terms central to understanding this content"],
  "insights": [
    "The most non-obvious or counterintuitive point in the content",
    "One concrete thing the reader can do differently after reading this",
    "Something the author implies but never explicitly states"
  ],
  "questions_raised": ["The most interesting open question or tension this content surfaces"],
  "best_quote": "The single most memorable sentence from the original verbatim, or empty string if none"
}}
</schema>

<rules>
- detailed_summary is the centrepiece — comprehensive enough that a reader fully understands the content without touching the original
- overview and detailed_summary serve DIFFERENT purposes — do not copy-paste between them
- insights must be earned from THIS content — no generic filler like "practice regularly" or "learn more"
- Return ONLY the JSON object. Nothing before the opening brace. Nothing after the closing brace.
</rules>

<example_output>
{{
  "one_liner": "Transformers replace sequential recurrence with parallelizable self-attention, making all modern LLMs possible.",
  "overview": "The 2017 'Attention is All You Need' paper introduced the Transformer architecture, ditching RNNs entirely in favour of self-attention layers. This unlocked full training parallelization — something RNNs could never achieve due to their sequential nature. The result was dramatically faster training and far better long-range dependency handling. It became the direct foundation for GPT, BERT, and virtually every LLM that followed.",
  "detailed_summary": "Before Transformers, sequence modelling was dominated by RNNs and LSTMs which processed tokens one at a time, creating an unavoidable sequential bottleneck that made GPU parallelization nearly impossible. The Transformer paper proposed throwing away recurrence entirely and replacing it with self-attention — a mechanism that computes relationships between every pair of tokens simultaneously. Each token produces three vectors (query, key, value) and attention scores are computed as scaled dot-products between queries and keys, producing a weighted sum of values that becomes the new token representation. Multi-head attention runs several of these operations in parallel, each learning different relationship types. Positional encodings — fixed sinusoidal vectors added to input embeddings — compensate for the fact that self-attention is inherently order-agnostic. The architecture stacks these attention layers with feed-forward layers, layer normalization, and residual connections. What made this transformative wasn't just accuracy but training efficiency — parallelizing over an entire sequence dropped training times by orders of magnitude, making the scaling laws we rely on today economically viable.",
  "key_concepts": ["self-attention", "multi-head attention", "positional encoding", "query-key-value", "encoder-decoder", "residual connections"],
  "insights": [
    "Positional encoding is a workaround not a solution — Transformers are inherently order-agnostic, which is why they can struggle with strict sequential tasks",
    "The real revolution wasn't accuracy but parallelizability — it made large-scale training economically feasible for the first time",
    "The paper quietly made RNNs, LSTMs, and GRUs obsolete but framed it modestly — the architecture's dominance wasn't obvious to everyone at release"
  ],
  "questions_raised": ["Does sinusoidal positional encoding fundamentally cap Transformer performance on tasks requiring strict causal ordering?"],
  "best_quote": "Attention is all you need."
}}
</example_output>

{title_block}<content>{content[:12000]}</content>

Output:"""

    raw = await llm_complete(summary_prompt, lang, max_tokens=1200)

    try:
        import re
        cleaned = raw.strip()
        match = re.search(r'\{.*\}', cleaned, re.DOTALL)
        if match:
            cleaned = match.group(0)
        parsed = json.loads(cleaned)
        result = json.dumps(parsed)
    except (json.JSONDecodeError, ValueError, Exception):
        result = raw

    await set_cached_response(cache_query, result, cache_key="summary", ttl_hours=settings.cache_ttl_summary_hours)
    return result


@traceable(name="extract_concepts", tags=["pipeline", "concepts"])
async def extract_concepts(content: str) -> list[str]:
    """Extract key concepts and entities from the content."""
    cache_query = content[:500]
    cached = await get_cached_response(cache_query, cache_key="concepts")
    if cached:
        try:
            return json.loads(cached)
        except Exception:
            return [c.strip() for c in cached.split(",") if c.strip()]

    prompt = f"You are an entity extraction system. Extract key concepts, entities, and important terms from the given text. Return them as a JSON array of strings. Return ONLY the JSON array, no other text.\n\nExtract key concepts from:\n\n{content[:4000]}"
    result = await llm_complete(prompt)
    try:
        cleaned = result.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1])
        concepts = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        concepts = [c.strip().strip('"').strip("'") for c in result.split(",") if c.strip()]

    await set_cached_response(cache_query, json.dumps(concepts), cache_key="concepts", ttl_hours=settings.cache_ttl_summary_hours)
    return concepts


@traceable(name="synthesize_answer", tags=["rag", "search"])
async def synthesize_answer(query: str, contexts: list[str], user_id: str | None = None) -> str:
    """RAG: Generate a synthesized answer from retrieved contexts."""
    cached = await get_cached_response(query, cache_key="rag", user_id=user_id)
    if cached:
        return cached

    lang = detect_language(query)
    context_block = "\n\n".join(contexts)

    if is_indic(lang):
        prompt = f"""<role>Aap MindVault ka RAG synthesis engine hain.</role>

<task>Neeche diye notes ke basis par question ka structured JSON answer do.</task>

<notes>
{context_block}
</notes>

<question>{query}</question>

<schema>
{{
  "answer": "2-4 sentences, natural prose, same language as question",
  "cited_source_ids": [1, 2],
  "confidence": "high | medium | low",
  "insufficient_context": true | false
}}
</schema>

<rules>
- cited_source_ids: [Source N] numbers from notes above jo directly relevant hain
- insufficient_context: true if notes mein enough info nahi hai
- confidence: high = notes directly answer karte hain, medium = partial, low = tangential
- Kabhi bhi notes se bahar ki information invent mat karo
- Return ONLY the JSON object
</rules>

Output:"""
    else:
        prompt = f"""<role>You are MindVault's RAG synthesis engine. You answer questions using ONLY the user's personal notes.</role>

<task>Answer the question using the provided notes. Return a structured JSON response.</task>

<notes>
{context_block}
</notes>

<question>{query}</question>

<schema>
{{
  "answer": "2-4 sentences, natural prose",
  "cited_source_ids": [1, 2],
  "confidence": "high | medium | low",
  "insufficient_context": true | false
}}
</schema>

<rules>
- cited_source_ids must reference [Source N] numbers from the notes above
- If notes don't contain enough to answer, set insufficient_context: true and explain in answer
- confidence: high = notes directly answer it, medium = partial, low = tangential
- Never invent facts not present in the notes
- Return ONLY the JSON object — no markdown, no preamble
</rules>

<example>
Notes: "[Source 1]: Title: Asyncio Notes\nCoroutines are defined with async def and awaited with await."
Question: "How do you define a coroutine in Python?"
Output: {{"answer": "A coroutine in Python is defined using the async def syntax and must be awaited when called.", "cited_source_ids": [1], "confidence": "high", "insufficient_context": false}}
</example>

Output:"""

    raw = await llm_complete(prompt, lang)

    # Parse and extract the plain answer string for downstream consumers
    # that still expect a string return value (agent.py synthesize_node)
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1])
        parsed = json.loads(cleaned)
        # Return the full JSON string — callers that need structured data
        # (routes/notes.py RAGResponse) can json.loads() it;
        # callers that need plain text get parsed["answer"]
        result = raw  # cache the full JSON
    except (json.JSONDecodeError, ValueError):
        result = raw  # fallback: cache raw string

    await set_cached_response(query, result, cache_key="rag", user_id=user_id, ttl_hours=settings.cache_ttl_rag_hours)
    return result


@traceable(name="generate_topic_name", tags=["pipeline", "clustering"])
async def generate_topic_name(contents: list[str]) -> str:
    """Generate a descriptive name for a topic cluster given sample contents."""
    samples = "\n---\n".join(c[:500] for c in contents[:5])
    cache_query = samples[:500]

    cached = await get_cached_response(cache_query, cache_key="topic_name")
    if cached:
        return cached

    prompt = f"You are a topic naming system. Given a set of related text excerpts, generate a short, descriptive topic name (2-5 words). Return ONLY the topic name, nothing else.\n\nGenerate a topic name for these related texts:\n\n{samples}"
    result = await llm_complete(prompt)
    await set_cached_response(cache_query, result, cache_key="topic_name", ttl_hours=settings.cache_ttl_topic_name_hours)
    return result


@traceable(name="summarize_youtube_video", tags=["pipeline", "youtube"])
async def summarize_youtube_video(transcript: str, content_language: str | None = None) -> str:
    """Summarize a YouTube video transcript into structured points natively in the requested language."""
    lang = content_language or detect_language(transcript)
    cache_query = transcript[:500]

    cached = await get_cached_response(cache_query, cache_key="summary")
    if cached:
        return cached

    if is_indic(lang):
        prompt = f"""
        Neeche diye gaye YouTube video transcript ka summary do (same language mein):
        1. 3 sentence ka TL;DR
        2. Key concepts learned (bullet points)
        3. Koi bhi actionable insights

        Transcript:
        {transcript[:50000]}
        """
    else:
        prompt = f"""
        Summarize this YouTube video transcript into:
        1. A 3-sentence TL;DR
        2. Key concepts learned (bullet points)
        3. Any actionable insights

        Transcript:
        {transcript[:50000]}
        """

    result = await llm_complete(prompt, lang)
    await set_cached_response(cache_query, result, cache_key="summary", ttl_hours=settings.cache_ttl_summary_hours)
    return result
