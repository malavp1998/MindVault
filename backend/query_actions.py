import asyncio
from sqlalchemy import select
from database import async_session
from models import PendingAgentAction

async def main():
    async with async_session() as session:
        result = await session.execute(select(PendingAgentAction).order_by(PendingAgentAction.created_at.desc()).limit(3))
        for action in result.scalars().all():
            print(f"Type: {action.action_type}")
            print(f"Payload: {action.payload}")
            print("-"*20)

if __name__ == "__main__":
    asyncio.run(main())
