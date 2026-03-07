import math
from datetime import datetime, timedelta
from enum import Enum

class Rating(str, Enum):
    FORGOT = "forgot"
    HARD   = "hard"
    GOOD   = "good"
    EASY   = "easy"

RATING_INTERVALS = {
    Rating.FORGOT: 1,
    Rating.HARD:   2,
    Rating.GOOD:   7,
    Rating.EASY:   14,
}

STABILITY_MULTIPLIERS = {
    Rating.FORGOT: 0.5,
    Rating.HARD:   1.2,
    Rating.GOOD:   2.0,
    Rating.EASY:   3.0,
}

MAX_INTERVAL_DAYS = 180
MIN_STABILITY = 1.0
MASTERED_THRESHOLD_DAYS = 60


def estimate_retention(days_since_review: float, stability: float) -> float:
    if days_since_review <= 0:
        return 1.0
    retention = math.exp(-days_since_review / max(stability, MIN_STABILITY))
    return round(max(0.0, min(1.0, retention)), 3)


def compute_next_review(current_interval: int, stability: float, rating: Rating) -> dict:
    rating = Rating(rating)
    new_stability = max(MIN_STABILITY, stability * STABILITY_MULTIPLIERS[rating])
    base_interval = RATING_INTERVALS[rating]

    if rating in [Rating.GOOD, Rating.EASY]:
        new_interval = max(base_interval, int(current_interval * STABILITY_MULTIPLIERS[rating]))
    else:
        new_interval = base_interval

    new_interval = min(new_interval, MAX_INTERVAL_DAYS)
    # Be aware: if stored as timezone aware we should use timezone.utc, but keeping close to spec
    next_review_date = datetime.utcnow() + timedelta(days=new_interval)
    is_mastered = new_interval >= MASTERED_THRESHOLD_DAYS

    return {
        "new_interval": new_interval,
        "new_stability": round(new_stability, 4),
        "next_review_date": next_review_date,
        "is_mastered": is_mastered,
        "estimated_retention_then": estimate_retention(new_interval, new_stability)
    }


def compute_priority_score(note_created_at: datetime, memory_state: dict) -> float:
    now = datetime.utcnow()

    days_since_review = memory_state.get("days_since_last_review", 999.0)
    stability = memory_state.get("stability", 1.0)
    next_review_date = memory_state.get("next_review_date")

    retention = estimate_retention(days_since_review, stability)
    forgetting_score = 1.0 - retention

    overdue_days = 0
    if next_review_date:
        if isinstance(next_review_date, str):
            next_review_date = datetime.fromisoformat(next_review_date)
        # Note: If next_review_date is offset-aware and now is naive, it might crash.
        # Ensure we are handling tz properly if necessary.
        if next_review_date.tzinfo is not None:
            now = datetime.now(next_review_date.tzinfo)
        
        if now > next_review_date:
            overdue_days = (now - next_review_date).days
    
    overdue_score = min(overdue_days / 7.0, 2.0)

    # Note age
    if note_created_at:
        if note_created_at.tzinfo is not None:
            now_for_age = datetime.now(note_created_at.tzinfo)
        else:
            now_for_age = now
        note_age_days = (now_for_age - note_created_at).days
    else:
        note_age_days = 999
        
    new_note_score = 1.0 if note_age_days <= 1 else 0.0

    low_stability_score = 1.0 / max(stability, 1.0)

    priority = (
        0.40 * forgetting_score +
        0.30 * overdue_score +
        0.15 * new_note_score +
        0.15 * low_stability_score
    )

    return round(priority, 4)
