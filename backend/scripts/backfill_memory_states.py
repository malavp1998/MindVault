import asyncio
import sys
import os

# Ensure we can import the app modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import async_session
from models import Note, NoteMemoryState
from services.revision_selector import initialize_memory_state
from sqlalchemy import select

async def main():
    print("Starting background script to backfill Spaced Repetition rows...")
    async with async_session() as db:
        # Get all notes that don't have a memory state
        query = select(Note).where(
            ~Note.id.in_(select(NoteMemoryState.note_id))
        )
        result = await db.execute(query)
        notes = result.scalars().all()
        
        print(f"Found {len(notes)} notes needing memory state initialization.")
        
        i = 0
        for note in notes:
            if note.user_id:
                try:
                    await initialize_memory_state(db, note.id, note.user_id)
                    i += 1
                except Exception as e:
                    print(f"Failed to backfill {note.id}: {e}")
                    
        print(f"Successfully initialized memory state for {i} notes.")

if __name__ == "__main__":
    asyncio.run(main())
