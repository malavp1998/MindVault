import uuid
from datetime import datetime, date, timedelta
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from services.spaced_repetition import compute_priority_score
from config import get_settings

settings = get_settings()
REVISION_THRESHOLD = getattr(settings, "REVISION_THRESHOLD", 5)

async def get_revision_queue(db: AsyncSession, user_id: uuid.UUID) -> list:
    now = datetime.utcnow()

    result = await db.execute(text("""
        SELECT
            n.id, n.title, n.summary, n.auto_tags, n.user_tags,
            n.source_url, n.created_at, n.topic_id,
            COALESCE(m.review_count, 0) as review_count,
            COALESCE(m.stability, 1.0) as stability,
            COALESCE(m.estimated_retention, 1.0) as estimated_retention,
            COALESCE(m.interval_days, 1) as interval_days,
            COALESCE(m.last_recall_rating, 'none') as last_recall_rating,
            m.next_review_date,
            m.last_reviewed_at,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(m.last_reviewed_at, n.created_at)))
                / 86400.0 as days_since_last_review,
            t.name as topic_name
        FROM notes n
        LEFT JOIN note_memory_state m ON m.note_id = n.id AND m.user_id = :uid
        LEFT JOIN topics t ON t.id = n.topic_id
        WHERE n.user_id = :uid
          AND n.processed = true
          AND COALESCE(m.interval_days, 1) < 60
        ORDER BY n.created_at DESC
    """), {"uid": str(user_id)})
    
    rows = result.mappings().all()

    if not rows:
        return []

    today_session_result = await db.execute(text("""
        SELECT notes_completed, notes_due FROM revision_sessions
        WHERE user_id = :uid AND date = CURRENT_DATE
    """), {"uid": str(user_id)})
    today_session = today_session_result.mappings().first()

    # If they actually finished the exact number of notes they were supposed to review today
    if today_session and \
       (today_session["notes_completed"] >= REVISION_THRESHOLD or \
       (today_session["notes_due"] > 0 and today_session["notes_completed"] >= today_session["notes_due"])):
        return []

    notes_with_scores = []
    for row in rows:
        note = dict(row)

        if note["next_review_date"]:
            next_dt = note["next_review_date"]
            if isinstance(next_dt, str):
                next_dt = datetime.fromisoformat(next_dt)
            
            # Convert both to naive UTC dates to avoid IST/UTC offset issues
            if next_dt.replace(tzinfo=None).date() > now.date():
                continue

        memory_state = {
            "days_since_last_review": float(note["days_since_last_review"] or 999),
            "stability": float(note["stability"]),
            "next_review_date": note["next_review_date"]
        }

        score = compute_priority_score(
            note_created_at=note["created_at"],
            memory_state=memory_state
        )
        note["priority_score"] = score
        notes_with_scores.append(note)

    notes_with_scores.sort(key=lambda x: x["priority_score"], reverse=True)

    selected = []
    seen_topics = set()

    for note in notes_with_scores:
        topic_id = str(note.get("topic_id")) if note.get("topic_id") else "none"
        if topic_id not in seen_topics:
            selected.append(note)
            seen_topics.add(topic_id)
        if len(selected) >= REVISION_THRESHOLD:
            break

    # If we still haven't met the threshold, backfill ignoring topic variety
    if len(selected) < REVISION_THRESHOLD:
        for note in notes_with_scores:
            if note not in selected:
                selected.append(note)
            if len(selected) >= REVISION_THRESHOLD:
                break

    return selected[:REVISION_THRESHOLD]


async def initialize_memory_state(db: AsyncSession, note_id: uuid.UUID, user_id: uuid.UUID):
    await db.execute(text("""
        INSERT INTO note_memory_state
        (id, note_id, user_id, stability, estimated_retention,
         next_review_date, interval_days, review_count, created_at, updated_at, avg_recall_score)
        VALUES (gen_random_uuid(), :nid, :uid, 1.0, 1.0, NOW(), 1, 0, NOW(), NOW(), 0.5)
        ON CONFLICT ON CONSTRAINT uq_note_user DO NOTHING
    """), {"nid": str(note_id), "uid": str(user_id)})
    await db.commit()


async def update_retention_scores():
    from database import async_session
    async with async_session() as db:
        await db.execute(text("""
            UPDATE note_memory_state
            SET
                estimated_retention = LEAST(1.0, GREATEST(0.0,
                    EXP(
                        -(EXTRACT(EPOCH FROM (NOW() - last_reviewed_at)) / 86400.0)
                        / GREATEST(stability, 1.0)
                    )
                )),
                updated_at = NOW()
            WHERE last_reviewed_at IS NOT NULL
        """))
        await db.commit()
