import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from database import get_db
from middleware.auth import CurrentUser
from models import User
from services.revision_selector import get_revision_queue
from services.spaced_repetition import compute_next_review, Rating

router = APIRouter(prefix="/revision", tags=["revision"])


class RateRequest(BaseModel):
    note_id: uuid.UUID
    session_id: uuid.UUID | None = None
    rating: Rating


class SkipRequest(BaseModel):
    note_id: uuid.UUID
    session_id: uuid.UUID | None = None


class CompleteSessionRequest(BaseModel):
    session_id: uuid.UUID


@router.get("/queue")
async def get_queue(
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    notes = await get_revision_queue(db, current_user.id)

    # Fetch stats
    stats_res = await db.execute(
        text("SELECT current_streak FROM user_revision_stats WHERE user_id = :uid"),
        {"uid": str(current_user.id)}
    )
    stats_row = stats_res.mappings().first()
    streak = stats_row["current_streak"] if stats_row else 0

    # Ensure there is a session for today if we have notes to review
    session_id = None
    if notes:
        # Check if today's session already exists
        session_res = await db.execute(
            text("""
                INSERT INTO revision_sessions (
                    id, user_id, date, notes_due, notes_completed, 
                    notes_skipped, forgot_count, hard_count, good_count, easy_count, streak_count
                )
                VALUES (gen_random_uuid(), :uid, CURRENT_DATE, :due, 0, 0, 0, 0, 0, 0, 0)
                ON CONFLICT ON CONSTRAINT uq_user_date DO UPDATE SET notes_due = :due
                RETURNING id
            """),
            {"uid": str(current_user.id), "due": len(notes)}
        )
        session_id = session_res.scalar()
        await db.commit()

    return {
        "notes": notes,
        "session_id": session_id,
        "streak": streak
    }


@router.post("/rate")
async def rate_note(
    req: RateRequest,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    # Get current memory state
    state_res = await db.execute(
        text("SELECT * FROM note_memory_state WHERE note_id = :nid AND user_id = :uid"),
        {"nid": str(req.note_id), "uid": str(current_user.id)}
    )
    state = state_res.mappings().first()
    
    if not state:
        raise HTTPException(404, "Memory state not found")

    current_interval = state["interval_days"] or 1
    stability = state["stability"] or 1.0

    # Calculate new spaced repetition values
    math_res = compute_next_review(current_interval, stability, req.rating)
    
    new_interval = math_res["new_interval"]
    new_stability = math_res["new_stability"]
    next_review_date = math_res["next_review_date"]
    is_mastered = math_res["is_mastered"]
    estimated_retention_then = math_res["estimated_retention_then"]

    # Update state
    await db.execute(
        text("""
            UPDATE note_memory_state
            SET
                review_count = review_count + 1,
                last_recall_rating = :rating,
                stability = :new_stability,
                estimated_retention = :est_retention,
                next_review_date = :next_review,
                last_reviewed_at = NOW(),
                interval_days = :new_interval,
                updated_at = NOW()
            WHERE id = :id
        """),
        {
            "rating": req.rating.value,
            "new_stability": new_stability,
            "est_retention": estimated_retention_then,
            "next_review": next_review_date,
            "new_interval": new_interval,
            "id": state["id"],
        }
    )

    # Log event
    # Using raw SQL for the event log
    await db.execute(
        text("""
            INSERT INTO review_events
            (id, note_id, user_id, session_id, rating, interval_before, interval_after,
             stability_before, stability_after)
            VALUES
            (gen_random_uuid(), :nid, :uid, :sid, :rating, :int_before, :int_after, :stab_before, :stab_after)
        """),
        {
            "nid": str(req.note_id), "uid": str(current_user.id), "sid": str(req.session_id) if req.session_id else None,
            "rating": req.rating.value, "int_before": current_interval, "int_after": new_interval,
            "stab_before": stability, "stab_after": new_stability
        }
    )
    
    await db.commit()

    message = ""
    if req.rating == Rating.FORGOT:
        message = "No worries! Review again tomorrow."
    elif req.rating == Rating.HARD:
        message = f"Getting there! Next review in {new_interval} days."
    elif req.rating == Rating.GOOD:
        message = f"Nice work! Next review in {new_interval} days."
    elif req.rating == Rating.EASY:
        message = f"Excellent! Next review in {new_interval} days. 🎉"

    return {
        "message": message,
        "new_interval": new_interval,
        "is_mastered": is_mastered
    }


@router.post("/skip")
async def skip_note(
    req: SkipRequest,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    # Push back to tomorrow
    await db.execute(
        text("""
            UPDATE note_memory_state
            SET next_review_date = NOW() + INTERVAL '1 day',
                updated_at = NOW()
            WHERE note_id = :nid AND user_id = :uid
        """),
        {"nid": str(req.note_id), "uid": str(current_user.id)}
    )
    await db.commit()
    return {"status": "skipped"}


@router.post("/session/complete")
async def complete_session(
    req: CompleteSessionRequest,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    # Update Session
    await db.execute(
        text("""
            UPDATE revision_sessions
            SET completed_at = NOW()
            WHERE id = :sid AND user_id = :uid
        """),
        {"sid": str(req.session_id), "uid": str(current_user.id)}
    )

    # Update User Stats (logic for streak)
    stats_res = await db.execute(
        text("SELECT * FROM user_revision_stats WHERE user_id = :uid"),
        {"uid": str(current_user.id)}
    )
    stats = stats_res.mappings().first()

    today = datetime.utcnow().date()
    current_streak = 0
    longest_streak = 0

    if not stats:
        current_streak = 1
        longest_streak = 1
        await db.execute(
            text("""
                INSERT INTO user_revision_stats
                (user_id, current_streak, longest_streak, total_sessions, last_session_date)
                VALUES (:uid, 1, 1, 1, CURRENT_DATE)
            """),
            {"uid": str(current_user.id)}
        )
    else:
        last_date = stats["last_session_date"]
        # Handle streak date math logic
        if last_date == today:
            current_streak = stats["current_streak"]
            longest_streak = stats["longest_streak"]
        else:
            if last_date:
                # Need to convert to datetime to safely do math if it's date
                if isinstance(last_date, str):
                    last_date = datetime.fromisoformat(last_date).date()
                if (today - last_date).days == 1:
                    current_streak = stats["current_streak"] + 1
                else:
                    current_streak = 1
            else:
                current_streak = 1

            longest_streak = max(stats["longest_streak"], current_streak)

            await db.execute(
                text("""
                    UPDATE user_revision_stats
                    SET current_streak = :cs,
                        longest_streak = :ls,
                        total_sessions = total_sessions + 1,
                        last_session_date = CURRENT_DATE,
                        updated_at = NOW()
                    WHERE user_id = :uid
                """),
                {"cs": current_streak, "ls": longest_streak, "uid": str(current_user.id)}
            )

    await db.commit()
    return {"status": "completed", "current_streak": current_streak}


@router.get("/stats")
async def get_stats(
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    stats_res = await db.execute(
        text("SELECT * FROM user_revision_stats WHERE user_id = :uid"),
        {"uid": str(current_user.id)}
    )
    stats = stats_res.mappings().first()

    # Determine due today efficiently
    due_res = await db.execute(
        text("""
            SELECT COUNT(*) FROM note_memory_state
            WHERE user_id = :uid
              AND (next_review_date IS NULL OR next_review_date <= NOW())
        """),
        {"uid": str(current_user.id)}
    )
    notes_due_today = due_res.scalar() or 0

    return {
        "current_streak": stats["current_streak"] if stats else 0,
        "total_reviews": stats["total_reviews"] if stats else 0,
        "notes_mastered": stats["notes_mastered"] if stats else 0,
        "notes_due_today": notes_due_today,
    }
