import uuid
import json
from typing import TypedDict, Literal
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
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
    system = SystemMessage(content="""
You are an intent classifier for a personal knowledge vault.
Classify the user's message as exactly one of: READ or WRITE.

READ  = searching, summarizing, recalling, explaining existing notes
WRITE = creating, updating, deleting, merging, tagging, renaming notes

Respond with ONLY the word READ or WRITE, nothing else.
    """)
    response = await llm.ainvoke([system] + state["messages"])
    intent = response.content.strip().upper()
    if intent not in ("READ", "WRITE"):
        intent = "READ"  # default safe
    return {**state, "intent": intent}


# ── Node 2: Call agent with tools ────────────────────────────

async def call_agent(state: AgentState) -> AgentState:
    system = SystemMessage(content=f"""
You are MindVault's AI agent. The user's vault belongs to user_id: {state["user_id"]}.

You have access to tools to search and manage their notes.

IMPORTANT RULES:
- For READ requests: call search_vault or read_note and return a concise, precise answer. ONLY use information from the tool results that directly answers the user's specific query. IGNORE any irrelevant search results or extra notes returned that do not directly pertain to the user's question. DO NOT summarize all search results if they are not relevant.
- For WRITE requests: call the appropriate propose_* tool which returns a PREVIEW.
  Do NOT execute writes directly. The propose_* tools only generate a preview.
- For UPDATE or DELETE requests: you MUST use the exact `id` field (a UUID string) returned from search_vault or read_note as your `note_id` argument! Do not pass the note title or topic as the note_id!
- Always be specific about what you are doing or proposing. Do not hallucinate note content.
    """)
    response = await llm_with_tools.ainvoke([system] + state["messages"])
    return {**state, "messages": state["messages"] + [response]}


# ── Node 3: Execute tool call ─────────────────────────────────

from langchain_core.messages import ToolMessage

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
    graph.add_node("call_agent",           call_agent)
    graph.add_node("execute_tool",         execute_tool)
    graph.add_node("synthesize_read",      synthesize_read)
    graph.add_node("store_pending_action", store_pending_action)

    graph.set_entry_point("classify_intent")
    graph.add_edge("classify_intent", "call_agent")
    
    # After LLM speaks, it either calls a tool or generates a final answer
    graph.add_conditional_edges("call_agent", route_after_agent)
    
    # After a tool executes, it either loops back to agent (reads) or stops for confirmation (writes)
    graph.add_conditional_edges("execute_tool", route_after_tool)
    
    graph.add_edge("synthesize_read",      END)
    graph.add_edge("store_pending_action", END)

    return graph.compile()


agentic_chat_graph = build_agentic_chat_graph()
