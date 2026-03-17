import asyncio
from sqlalchemy import select, func
from database import async_session
from models import User, Note, NoteMemoryState, NoteLink
from services.revision_selector import refresh_user_retention

async def test():
    async with async_session() as db:
        user = await db.execute(select(User).where(User.email == 'jitu@gmail.com'))
        u = user.scalar_one_or_none()
        if not u:
            print("User not found!")
            return
            
        print(f"Refreshing retention for {u.id}...")
        try:
            await refresh_user_retention(db, u.id)
        except Exception as e:
            print("Error in refresh_user_retention:", e)
            return

        backlink_subquery = (
            select(func.count(NoteLink.id))
            .where(NoteLink.target_id == Note.id)
            .correlate(Note)
            .scalar_subquery()
        )

        query = (
            select(Note, NoteMemoryState.estimated_retention, NoteMemoryState.review_count, backlink_subquery.label("backlink_count"))
            .outerjoin(NoteMemoryState, (Note.id == NoteMemoryState.note_id) & (NoteMemoryState.user_id == u.id))
            .where(Note.user_id == u.id)
            .order_by(Note.created_at.desc())
        )
        
        result = await db.execute(query)
        rows = result.all()
        print(f"Query returned {len(rows)} rows.")

if __name__ == "__main__":
    asyncio.run(test())
