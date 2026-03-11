import asyncio
from sqlalchemy import select
from database import get_db, async_session_maker
from models import PendingAgentAction

async def main():
    async with async_session_maker() as session:
        result = await session.execute(select(PendingAgentAction).order_by(PendingAgentAction.created_at.desc()).limit(3))
        actions = result.scalars().all()
        for action in actions:
            print(f"Action: {action.action_type}")
            print(f"Payload: {action.payload}")
            print("-" * 20)

asyncio.run(main())
