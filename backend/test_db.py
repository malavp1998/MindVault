import asyncio
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from database import async_session
from models import User, Note

async def test():
    async with async_session() as db:
        user = await db.execute(select(User).where(User.email == 'jitu@gmail.com'))
        u = user.scalar_one_or_none()
        if not u:
            print("User not found!")
            return
        
        notes = await db.execute(select(Note).where(Note.user_id == u.id))
        all_notes = notes.scalars().all()
        print(f"User {u.email} has {len(all_notes)} notes.")
        if all_notes:
            print(all_notes[0].title)

asyncio.run(test())
