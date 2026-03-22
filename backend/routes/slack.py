import asyncio
import logging
from fastapi import APIRouter, Request
from slack_bolt.async_app import AsyncApp
from slack_bolt.adapter.fastapi.async_handler import AsyncSlackRequestHandler
from sqlalchemy import select

from config import get_settings
from database import async_session
from models import User, Note
from services.llm import llm_complete
from services.pipeline import process_note
from services.agent import rag_agent

logger = logging.getLogger(__name__)

settings = get_settings()

router = APIRouter()

# Initialize Slack App
# If tokens are missing when the app boots, they will be empty strings,
# so we only configure the app if they exist, or just pass them (bolt will error if used without tokens, but won't crash on boot)
slack_app = AsyncApp(
    token=settings.slack_bot_token or "dummy_bot_token",
    signing_secret=settings.slack_signing_secret or "dummy_secret"
)
slack_handler = AsyncSlackRequestHandler(slack_app)

@router.post("/events")
async def slack_events_endpoint(req: Request):
    """Endpoint to receive Slack events."""
    return await slack_handler.handle(req)

@slack_app.event("message")
async def handle_message_events(body, logger, say):
    event = body.get("event", {})
    text = str(event.get("text", ""))
    slack_team_id = str(body.get("team_id") or event.get("team", ""))
    channel_type = str(event.get("channel_type", ""))
    
    # Ignore bot messages
    if event.get("bot_id"):
        return
        
    # Only respond to DMs
    if channel_type != "im":
        return

    await process_slack_message(text, slack_team_id, say)

@slack_app.event("app_mention")
async def handle_app_mentions(body, logger, say):
    event = body.get("event", {})
    text = str(event.get("text", ""))
    slack_team_id = str(body.get("team_id") or event.get("team", ""))
    
    # Remove the mention from the text using regex
    import re
    text = re.sub(r'<@[A-Z0-9]+>', '', text).strip()
    
    await process_slack_message(text, slack_team_id, say)

async def process_slack_message(text: str, slack_team_id: str, say):
    if not text or not slack_team_id:
        return

    # Check for account linking command
    if text.lower().startswith("link account") or text.lower().startswith("link workspace"):
        import re
        from sqlalchemy import update, delete
        match = re.search(r'([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})', text)
        if match:
            email = match.group(1)
            async with async_session() as db:
                result = await db.execute(select(User).filter_by(email=email))
                real_user = result.scalars().first()
                if real_user:
                    old_result = await db.execute(select(User).filter_by(slack_user_id=slack_team_id))
                    old_user = old_result.scalars().first()
                    
                    if old_user and old_user.id != real_user.id:
                        # Move all notes to the real user
                        await db.execute(update(Note).where(Note.user_id == old_user.id).values(user_id=real_user.id))
                        # Delete the temporary auto-created user
                        await db.execute(delete(User).where(User.id == old_user.id))
                        
                    real_user.slack_user_id = slack_team_id
                    await db.commit()
                    await say(f"🔗 Successfully linked this entire Slack Workspace to {email}! Any previous notes have been moved to your main account.")
                else:
                    await say(f"❌ Could not find an account with email {email}.")
        else:
            await say("❌ Please provide a valid email address. Example: `link workspace my@email.com`")
        return

    # 1. Identity Mapping
    async with async_session() as db:
        result = await db.execute(select(User).filter_by(slack_user_id=slack_team_id))
        user = result.scalars().first()
        if not user:
            # Auto-create a unique shared account for this Slack Workspace
            username = f"slack_team_{slack_team_id}"
            user = User(
                username=username,
                email=f"{username}@slack.local",
                slack_user_id=slack_team_id
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
            await say(f"👋 Welcome! I've created a dedicated MindVault profile for this Slack Workspace. All messages sent to me from anyone here will be saved into this shared vault. Let me process your request...")

        user_id = user.id

    # 2. Intent Routing via LLM
    prompt = f"""<role>You are the MindVault intent router.</role>
<task>Classify the following user message into one of two intents: "SAVE_NOTE" or "SEARCH_OR_CHAT".</task>
<rules>
- "SAVE_NOTE": The user is giving you information, a thought, a link, or asking you to save/remember something. Example: "Save this", "My thoughts on X", "Meeting notes: ..."
- "SEARCH_OR_CHAT": The user is asking a question, asking you to find something, or having a general conversation. Example: "What do I know about X?", "Find my notes on Y"
- Return EXACTLY ONE string: "SAVE_NOTE" or "SEARCH_OR_CHAT". Nothing else.
</rules>
<message>{text}</message>
Intent:"""
    
    intent_raw = await llm_complete(prompt, "en")
    intent = intent_raw.strip().upper()
    
    if "SAVE_NOTE" in intent:
        await say("⏳ Saving to your vault...")
        
        async with async_session() as db:
            note = Note(
                title=f"Slack Note: {text[:30]}...",
                content=text,
                source_url="slack://message",
                tags=["slack"],
                user_id=user_id,
                language="en"
            )
            db.add(note)
            await db.flush()
            await db.refresh(note)
            note_id = note.id
            await db.commit()
            
        # Trigger async AI processing pipeline
        asyncio.create_task(process_note(note_id))
        
        await say("✅ Saved and processing! It will be automatically summarized, tagged, and connected in your graph.")

    else:
        # SEARCH_OR_CHAT intent -> RAG Agent
        await say("🔍 Searching your vault...")
        try:
            initial_state = {
                "query": text,
                "retrieved_notes": [],
                "final_answer": "",
                "sources": [],
                "user_id": str(user_id),
            }
            final_state = await rag_agent.ainvoke(initial_state)
            answer = final_state.get("final_answer", "")
            sources = final_state.get("sources", [])
            
            if sources:
                source_titles = "\\n".join([f"• {s.note.title}" for s in sources])
                reply = f"{answer}\\n\\n*Sources:*\\n{source_titles}"
            else:
                reply = answer
                
            await say(reply)
            
        except Exception as e:
            logger.error(f"Error in RAG Agent: {e}")
            await say("❌ Sorry, I encountered an error while searching your vault.")

