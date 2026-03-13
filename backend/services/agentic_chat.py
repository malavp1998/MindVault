import uuid
import json
from typing import TypedDict, Literal
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
from sqlalchemy.ext.asyncio import AsyncSession
from models import PendingAgentAction
from services.agent_tools import (
    search_vault, read_note,
    propose_create_note, propose_update_note, propose_delete_note
)
from services.llm import llm_complete
from langsmith import traceable

# ── Utilities ─────────────────────────────────────────────────

@traceable(name="generate_session_title", tags=["chat", "title"])
async def generate_session_title(first_message: str) -> str:
    """Generate a short 4-6 word title for a chat session."""
    prompt = (
        "Generate a short 4-6 word title for a chat session "
        "that starts with this message. "
        "Return ONLY the title, nothing else.\n\n"
        f"Message: {first_message}"
    )
    title = await llm_complete(prompt, "en")
    # Clean up any quotes the LLM might add
    return title.strip().strip('"').strip("'")[:255]


# ── State ─────────────────────────────────────────────────────

class AgentState(TypedDict):
    messages: list
    user_id: str
    intent: str                    # "read" or "write"
    tool_result: dict | list | None # result from tool call
    pending_action_id: str | None  # UUID of stored PendingAgentAction
    final_response: str | None     # message to send back to frontend
    compressed_summary: str | None   # rolling summary of compressed turns


# ── LLM ───────────────────────────────────────────────────────

llm = ChatGroq(model="llama-3.3-70b-versatile", temperature=0)

READ_TOOLS  = [search_vault, read_note]
WRITE_TOOLS = [propose_create_note, propose_update_note, propose_delete_note]
ALL_TOOLS   = READ_TOOLS + WRITE_TOOLS

llm_with_tools = llm.bind_tools(ALL_TOOLS)


# ── Node 1: Classify intent ───────────────────────────────────

async def classify_intent(state: AgentState) -> AgentState:
    """
    Ask LLM to classify whether this is a READ or WRITE intent.
    READ  = search, summarize, explain, recall, find
    WRITE = create, update, delete, merge, tag, rename
    """
    system = SystemMessage(content="""<role>You are an intent classifier for a personal knowledge vault.</role>

<intents>
READ  = search, recall, summarize, explain, find, list, compare existing notes
WRITE = create, update, delete, merge, rename, tag, reorganize notes
</intents>

<output_schema>
{"primary": "READ|WRITE", "has_secondary_write": true|false, "confidence": "high|medium|low"}
</output_schema>

<examples>
"what do I know about Python async?" → {"primary": "READ", "has_secondary_write": false, "confidence": "high"}
"find my transformer note and update its tags" → {"primary": "READ", "has_secondary_write": true, "confidence": "high"}
"create a note about gradient descent" → {"primary": "WRITE", "has_secondary_write": false, "confidence": "high"}
"summarize everything I saved this week" → {"primary": "READ", "has_secondary_write": false, "confidence": "medium"}
</examples>

Return ONLY the JSON object, nothing else.""")

    # Only the latest user message matters for intent — no history needed
    last_user_msg = next(
        (m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)),
        state["messages"][-1],
    )
    response = await llm.ainvoke([system, last_user_msg])

    try:
        cleaned = response.content.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1])
        parsed = json.loads(cleaned)
        intent = parsed.get("primary", "READ").upper()
        if intent not in ("READ", "WRITE"):
            intent = "READ"
    except (json.JSONDecodeError, ValueError):
        intent = "READ"  # safe fallback

    return {**state, "intent": intent}


# ── Token check ───────────────────────────────────────────────

from config import get_settings as _get_settings

def _estimate_tokens(messages: list) -> int:
    """
    Rough token estimate: 1 token ≈ 4 characters.
    Used only for gating compression — does not need to be exact.
    """
    total_chars = sum(
        len(m.content) if isinstance(m.content, str) else
        len(str(m.content))
        for m in messages
    )
    return total_chars // 4


# ── Node 1b: Compress history to stay within context budget ──

TOOL_MSG_TYPES = (ToolMessage,)   # ToolMessage imported at top of execute_tool block

async def compress_history(state: AgentState) -> AgentState:
    """
    Two-stage context compression:
      Stage 1: Strip ToolMessages from all but the most recent tool call round.
               These carry large RAG payloads that are stale after synthesis.
      Stage 2: If token estimate still exceeds threshold, LLM-summarize the
               oldest half of human/AI turns into a single SystemMessage summary
               and prepend it, replacing those turns.
    """
    from config import get_settings
    settings = get_settings()
    from langchain_core.messages import ToolMessage as TM

    messages = list(state["messages"])
    if not messages:
        return state

    # ── Stage 1: Strip stale ToolMessages ────────────────────
    # Find index of the most recent AIMessage that made a tool call
    last_tool_call_idx = -1
    for i in range(len(messages) - 1, -1, -1):
        msg = messages[i]
        if isinstance(msg, AIMessage) and getattr(msg, "tool_calls", None):
            last_tool_call_idx = i
            break

    if last_tool_call_idx > 0:
        # Keep everything from the last tool call round onward;
        # strip ToolMessages from all earlier positions
        cleaned = []
        for i, msg in enumerate(messages):
            if i < last_tool_call_idx and isinstance(msg, TM):
                continue   # drop stale tool result
            cleaned.append(msg)
        messages = cleaned

    # ── Stage 2: LLM compress if still over threshold ────────
    threshold = getattr(settings, "chat_compression_threshold", 6000)
    if _estimate_tokens(messages) <= threshold:
        return {**state, "messages": messages}

    # Separate human/AI turns from any leading SystemMessages
    system_msgs = [m for m in messages if isinstance(m, SystemMessage)]
    conv_msgs   = [m for m in messages if not isinstance(m, SystemMessage)]

    # Only compress if there are enough turns to make it worthwhile
    if len(conv_msgs) < 4:
        return {**state, "messages": messages}

    # Compress the oldest half; keep the newest half verbatim for recency
    half = len(conv_msgs) // 2
    old_turns  = conv_msgs[:half]
    keep_turns = conv_msgs[half:]

    # Build a readable transcript of the old turns for the summarizer
    transcript_lines = []
    for m in old_turns:
        role = "User" if isinstance(m, HumanMessage) else "Assistant"
        content = m.content if isinstance(m.content, str) else str(m.content)
        transcript_lines.append(f"{role}: {content[:600]}")   # cap each turn at 600 chars
    transcript = "\n\n".join(transcript_lines)

    # Retrieve any prior rolling summary to chain compression across sessions
    prior_summary = state.get("compressed_summary") or ""
    prior_block   = f"Prior context:\n{prior_summary}\n\n" if prior_summary else ""

    compression_prompt = f"""{prior_block}Summarize the following conversation excerpt in 3-5 sentences.
Preserve: key facts the user mentioned, notes they asked about, any decisions made.
Discard: greetings, filler, redundant search results.
Return ONLY the summary, no preamble.

---
{transcript}
---"""

    try:
        summary_response = await llm.ainvoke([
            SystemMessage(content="You are a concise conversation summarizer."),
            HumanMessage(content=compression_prompt),
        ])
        new_summary = summary_response.content.strip()
    except Exception:
        # If compression fails, fall back gracefully — skip compression this turn
        return {**state, "messages": messages}

    summary_msg = SystemMessage(
        content=f"[Conversation summary — earlier context]\n{new_summary}"
    )

    compressed_messages = system_msgs + [summary_msg] + keep_turns

    return {
        **state,
        "messages": compressed_messages,
        "compressed_summary": new_summary,
    }


# ── Node 2: Call agent with tools ────────────────────────────

async def call_agent(state: AgentState) -> AgentState:
    system = SystemMessage(content=f"""<role>MindVault AI agent for user_id: {state["user_id"]}</role>

<capabilities>
- search_vault: semantic search across user's notes — use for any recall/find/summarize intent
- read_note: fetch full note content by UUID — use when you need complete text of a specific note
- propose_create_note: draft a new note (returns preview, requires user confirmation)
- propose_update_note: suggest edits to existing note (returns diff preview, requires confirmation)
- propose_delete_note: propose deletion (returns preview, requires confirmation)
</capabilities>

<constraints>
<constraint id="scope">Only access notes belonging to user_id: {state["user_id"]} — never cross user boundaries</constraint>
<constraint id="writes">WRITE tools return previews only — never execute writes directly</constraint>
<constraint id="ids">For update/delete: use exact UUID `id` field from search_vault/read_note results — never use title or topic name as note_id</constraint>
<constraint id="relevance">Only cite search results that directly answer the query — ignore tangential matches</constraint>
<constraint id="hallucination">Never invent note content — only use what tool results return</constraint>
</constraints>

<reasoning_pattern>
1. Identify what the user specifically needs
2. Choose the minimal set of tools required (prefer one search over two)
3. Use tool results only — do not supplement with invented content
4. Synthesize a direct, concise response
</reasoning_pattern>""")
    response = await llm_with_tools.ainvoke([system] + state["messages"])
    return {**state, "messages": state["messages"] + [response]}


# ── Node 3: Execute tool call ─────────────────────────────────

# ── Node 3: Execute tool call ─────────────────────────────────

async def execute_tool(state: AgentState) -> AgentState:
    last_message = state["messages"][-1]
    if not last_message.tool_calls:
        return state

    tool_call = last_message.tool_calls[0]
    tool_name = tool_call["name"]
    tool_args = tool_call["args"]

    tool_map = {t.name: t for t in ALL_TOOLS}
    if tool_name not in tool_map:
        tool_msg = ToolMessage(content="I couldn't find the right tool for that.", tool_call_id=tool_call["id"])
        return {**state, "messages": state["messages"] + [tool_msg]}

    result = await tool_map[tool_name].ainvoke(tool_args)
    
    # Format for Langchain to continue reasoning
    tool_msg = ToolMessage(content=json.dumps(result), tool_call_id=tool_call["id"])
    
    # Accumulate read tool results for cited_notes, otherwise just store the latest result
    if tool_name in [t.name for t in READ_TOOLS]:
        current_res = state.get("tool_result")
        
        res_list = []
        if isinstance(current_res, list):
            res_list = list(current_res)
        elif isinstance(current_res, dict):
            res_list = [current_res]
            
        new_res = result if isinstance(result, list) else [result]
        
        # De-duplicate by ID
        seen_ids = {x.get("id") for x in res_list if isinstance(x, dict) and "id" in x}
        combined = list(res_list)
        for x in new_res:
            if isinstance(x, dict) and "id" in x and x["id"] not in seen_ids:
                combined.append(x)
                seen_ids.add(x["id"])
        tool_result = combined
    else:
        tool_result = result
        
    return {**state, "messages": state["messages"] + [tool_msg], "tool_result": tool_result}


# ── Node 4: Synthesize READ answer ───────────────────────────

async def synthesize_read(state: AgentState) -> AgentState:
    last_message = state["messages"][-1]
    # If the LLM already gave a direct text response, just use it
    if last_message.content and not last_message.tool_calls:
        return {**state, "final_response": last_message.content}
        
    system = SystemMessage(content="""
You are MindVault's AI assistant. Answer the user's question using ONLY the provided search results that are directly relevant.
IGNORE any search results that do not pertain to the specific question asked. Do NOT summarize all search results if they are not relevant to the user's query.
Be concise and cite the note title or topic when referencing information (do NOT show raw note IDs to the user).
    """)
    response = await llm.ainvoke([system] + state["messages"])
    return {**state, "final_response": response.content}


# ── Node 5: Store WRITE as pending action ────────────────────

async def store_pending_action(state: AgentState, config: RunnableConfig) -> AgentState:
    db: AsyncSession = config["configurable"]["db"]
    preview = state.get("tool_result")
    if not preview or not isinstance(preview, dict):
        return {**state, "final_response": "I couldn't generate a preview for that action."}

    if "error" in preview:
        # If the tool failed validation, we don't store it. We ask the LLM to try again.
        return {**state, "final_response": str(preview["error"])}

    action = PendingAgentAction(
        user_id=state["user_id"],
        action_type=preview["action_type"],
        payload=preview,
        preview_message=preview["preview_message"],
    )
    db.add(action)
    await db.commit()
    await db.refresh(action)

    return {
        **state,
        "pending_action_id": str(action.id),
        "final_response": "__PENDING_CONFIRMATION__"   # frontend flag
    }


# ── Router ────────────────────────────────────────────────────

def route_after_agent(state: AgentState) -> Literal["execute_tool", "synthesize_read"]:
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "execute_tool"
    return "synthesize_read"

def route_after_tool(state: AgentState) -> Literal["call_agent", "store_pending_action"]:
    last_message = state["messages"][-2]  # The AIMessage that called the tool
    if not last_message.tool_calls:
         return "call_agent"
         
    tool_name = last_message.tool_calls[0]["name"]
    if tool_name in [t.name for t in WRITE_TOOLS]:
        # If the WRITE tool returned a validation error (e.g. invalid UUID hallucination),
        # force the graph to loop back to the LLM so it reads the error and can try searching.
        tool_result = state.get("tool_result")
        if tool_result and isinstance(tool_result, dict) and "error" in tool_result:
            return "call_agent"
            
        return "store_pending_action"
        
    return "call_agent"


# ── Build Graph ───────────────────────────────────────────────

def build_agentic_chat_graph():
    graph = StateGraph(AgentState)
    graph.add_node("classify_intent",      classify_intent)
    graph.add_node("compress_history",     compress_history)
    graph.add_node("call_agent",           call_agent)
    graph.add_node("execute_tool",         execute_tool)
    graph.add_node("synthesize_read",      synthesize_read)
    graph.add_node("store_pending_action", store_pending_action)

    graph.set_entry_point("classify_intent")
    graph.add_edge("classify_intent", "compress_history")
    graph.add_edge("compress_history", "call_agent")
    
    # After LLM speaks, it either calls a tool or generates a final answer
    graph.add_conditional_edges("call_agent", route_after_agent)
    
    # After a tool executes, it either loops back to agent (reads) or stops for confirmation (writes)
    graph.add_conditional_edges("execute_tool", route_after_tool)
    
    graph.add_edge("synthesize_read",      END)
    graph.add_edge("store_pending_action", END)

    return graph.compile()


agentic_chat_graph = build_agentic_chat_graph()
