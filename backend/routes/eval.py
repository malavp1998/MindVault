from __future__ import annotations
"""Retrieval Evaluation Pipeline — golden dataset, offline runner, stats."""

import uuid
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from middleware.auth import CurrentUser, CurrentAdmin
from models import User, EvalQuery, EvalRun, RetrievalLog, ResultVote, Note
from services.embedding import get_embedding
from config import get_settings

settings = get_settings()
router = APIRouter(prefix="/api/eval", tags=["eval"])


# ── Schemas ────────────────────────────────────────────────────

class EvalQueryIn(BaseModel):
    query_text: str
    expected_note_id: str
    expected_note_title: str
    query_type: str = "question"  # keyword|question|vague|indic


class EvalQueryBulkIn(BaseModel):
    queries: List[EvalQueryIn]


class VoteIn(BaseModel):
    query_text: str
    note_id: str
    vote: int  # 1 or -1


# ── Golden Dataset CRUD ────────────────────────────────────────

@router.post("/golden", status_code=201)
async def bulk_insert_golden(
    body: EvalQueryBulkIn,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Paste your JSON golden dataset here. Inserts all pairs in one shot."""
    inserted = 0
    for q in body.queries:
        try:
            note_id = uuid.UUID(q.expected_note_id)
        except ValueError:
            raise HTTPException(400, f"Invalid UUID: {q.expected_note_id}")

        # Verify note belongs to this user
        note = await db.get(Note, note_id)
        if not note or note.user_id != current_user.id:
            raise HTTPException(404, f"Note {q.expected_note_id} not found in your vault")

        row = EvalQuery(
            query_text=q.query_text,
            expected_note_id=note_id,
            expected_note_title=q.expected_note_title,
            query_type=q.query_type,
            user_id=current_user.id,
        )
        db.add(row)
        inserted += 1

    await db.commit()
    return {"inserted": inserted, "message": f"Golden dataset loaded — {inserted} queries ready"}


@router.get("/golden")
async def list_golden(
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """List all golden query pairs for this user."""
    result = await db.execute(
        select(EvalQuery)
        .where(EvalQuery.user_id == current_user.id)
        .order_by(EvalQuery.created_at.desc())
    )
    rows = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "query_text": r.query_text,
            "expected_note_id": str(r.expected_note_id),
            "expected_note_title": r.expected_note_title,
            "query_type": r.query_type,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.delete("/golden/{query_id}", status_code=204)
async def delete_golden(
    query_id: uuid.UUID,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single golden query pair."""
    row = await db.get(EvalQuery, query_id)
    if not row or row.user_id != current_user.id:
        raise HTTPException(404, "Query not found")
    await db.delete(row)
    await db.commit()


# ── Offline Eval Runner ────────────────────────────────────────

@router.post("/run")
async def run_eval(
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Run the offline eval against all golden queries.
    For each query: embeds it, searches pgvector, checks if expected note is in top-3.
    Computes Precision@3, avg similarity, zero-result rate.
    Applies regression gate vs last passing run.
    """
    # Load golden dataset
    result = await db.execute(
        select(EvalQuery).where(EvalQuery.user_id == current_user.id)
    )
    golden = result.scalars().all()

    if not golden:
        raise HTTPException(400, "No golden queries found. POST to /api/eval/golden first.")

    raw_results = []
    hit_count = 0
    all_similarities = []
    zero_result_count = 0

    for gq in golden:
        # Embed the query
        try:
            query_embedding = await get_embedding(gq.query_text)
        except Exception as e:
            raw_results.append({
                "query": gq.query_text,
                "error": str(e),
                "hit": False,
            })
            continue

        # Search pgvector — top 3, scoped to user
        rows = await db.execute(
            text("""
                SELECT id,
                       1 - (embedding <=> CAST(:emb AS vector)) as similarity
                FROM notes
                WHERE embedding IS NOT NULL
                  AND user_id = CAST(:uid AS uuid)
                  AND 1 - (embedding <=> CAST(:emb AS vector)) >= :threshold
                ORDER BY embedding <=> CAST(:emb AS vector)
                LIMIT 3
            """),
            {
                "emb": str(query_embedding),
                "uid": str(current_user.id),
                "threshold": settings.search_similarity_threshold,
            },
        )
        top_3 = rows.all()

        if not top_3:
            zero_result_count += 1
            raw_results.append({
                "query": gq.query_text,
                "expected_note_id": str(gq.expected_note_id),
                "returned_ids": [],
                "similarities": [],
                "hit": False,
                "zero_result": True,
            })
            continue

        returned_ids = [str(r[0]) for r in top_3]
        similarities = [round(float(r[1]), 4) for r in top_3]
        all_similarities.extend(similarities)

        hit = str(gq.expected_note_id) in returned_ids
        if hit:
            hit_count += 1

        raw_results.append({
            "query": gq.query_text,
            "expected_note_id": str(gq.expected_note_id),
            "expected_note_title": gq.expected_note_title,
            "returned_ids": returned_ids,
            "similarities": similarities,
            "hit": hit,
        })

    total = len(golden)
    precision_at_3 = round(hit_count / total, 4) if total > 0 else 0.0
    avg_similarity = round(sum(all_similarities) / len(all_similarities), 4) if all_similarities else 0.0
    zero_result_rate = round(zero_result_count / total, 4) if total > 0 else 0.0

    # ── Regression Gate ────────────────────────────────────────
    # Load last passing run to compare against
    last_pass = await db.execute(
        select(EvalRun)
        .where(EvalRun.user_id == current_user.id, EvalRun.gate_passed == True)
        .order_by(EvalRun.created_at.desc())
        .limit(1)
    )
    baseline = last_pass.scalar_one_or_none()

    gate_passed = True
    gate_reason = None

    if baseline:
        if precision_at_3 < baseline.precision_at_3 - 0.05:
            gate_passed = False
            gate_reason = (
                f"Precision@3 dropped from {baseline.precision_at_3:.0%} "
                f"to {precision_at_3:.0%} — exceeds 5pp regression threshold"
            )
        elif avg_similarity < 0.55:
            gate_passed = False
            gate_reason = f"avg_similarity {avg_similarity:.3f} is below 0.55 floor"
        elif zero_result_rate > 0.20:
            gate_passed = False
            gate_reason = f"zero_result_rate {zero_result_rate:.0%} exceeds 20% ceiling"

    # Save run
    run = EvalRun(
        user_id=current_user.id,
        total_queries=total,
        precision_at_3=precision_at_3,
        avg_similarity=avg_similarity,
        zero_result_rate=zero_result_rate,
        gate_passed=gate_passed,
        gate_reason=gate_reason,
        raw_results=raw_results,
    )
    db.add(run)
    await db.commit()

    return {
        "run_id": str(run.id),
        "total_queries": total,
        "hits": hit_count,
        "precision_at_3": f"{precision_at_3:.0%}",
        "avg_similarity": avg_similarity,
        "zero_result_rate": f"{zero_result_rate:.0%}",
        "gate_passed": gate_passed,
        "gate_reason": gate_reason,
        "raw_results": raw_results,
    }


# ── Stats (for /stats page) ────────────────────────────────────

@router.get("/stats")
async def get_eval_stats(
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Returns all data needed to render the /stats dashboard page."""

    # Last 5 eval runs
    runs_result = await db.execute(
        select(EvalRun)
        .where(EvalRun.user_id == current_user.id)
        .order_by(EvalRun.created_at.desc())
        .limit(5)
    )
    runs = runs_result.scalars().all()

    # Last 30 days of live logs — daily aggregates
    daily = await db.execute(
        text("""
            SELECT
                DATE(created_at) as day,
                COUNT(*) as queries,
                ROUND(AVG(avg_similarity)::numeric, 4) as avg_sim,
                ROUND(AVG(CASE WHEN notes_returned = 0 THEN 1 ELSE 0 END)::numeric, 4) as zero_rate
            FROM retrieval_logs
            WHERE user_id = CAST(:uid AS uuid)
              AND created_at >= NOW() - INTERVAL '30 days'
            GROUP BY DATE(created_at)
            ORDER BY day ASC
        """),
        {"uid": str(current_user.id)},
    )
    daily_rows = daily.all()

    # Low confidence queries (last 7 days)
    low_conf = await db.execute(
        text("""
            SELECT query_text, avg_similarity, notes_returned, created_at
            FROM retrieval_logs
            WHERE user_id = CAST(:uid AS uuid)
              AND (avg_similarity < 0.55 OR notes_returned = 0)
              AND created_at >= NOW() - INTERVAL '7 days'
            ORDER BY created_at DESC
            LIMIT 20
        """),
        {"uid": str(current_user.id)},
    )
    low_conf_rows = low_conf.all()

    # Vote summary
    votes = await db.execute(
        text("""
            SELECT
                SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END) as thumbs_up,
                SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) as thumbs_down
            FROM result_votes
            WHERE user_id = CAST(:uid AS uuid)
        """),
        {"uid": str(current_user.id)},
    )
    vote_row = votes.one_or_none()

    return {
        "eval_runs": [
            {
                "id": str(r.id),
                "created_at": r.created_at.isoformat(),
                "precision_at_3": r.precision_at_3,
                "avg_similarity": r.avg_similarity,
                "zero_result_rate": r.zero_result_rate,
                "gate_passed": r.gate_passed,
                "gate_reason": r.gate_reason,
                "total_queries": r.total_queries,
            }
            for r in runs
        ],
        "daily_logs": [
            {
                "day": str(r[0]),
                "queries": r[1],
                "avg_similarity": float(r[2]) if r[2] else None,
                "zero_result_rate": float(r[3]) if r[3] else None,
            }
            for r in daily_rows
        ],
        "low_confidence_queries": [
            {
                "query_text": r[0],
                "avg_similarity": float(r[1]) if r[1] else None,
                "notes_returned": r[2],
                "created_at": r[3].isoformat(),
            }
            for r in low_conf_rows
        ],
        "votes": {
            "thumbs_up": int(vote_row[0] or 0) if vote_row else 0,
            "thumbs_down": int(vote_row[1] or 0) if vote_row else 0,
        },
    }


# ── Eval Run history ───────────────────────────────────────────

@router.get("/runs")
async def list_runs(
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """List all eval runs for this user."""
    result = await db.execute(
        select(EvalRun)
        .where(EvalRun.user_id == current_user.id)
        .order_by(EvalRun.created_at.desc())
    )
    runs = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "created_at": r.created_at.isoformat(),
            "total_queries": r.total_queries,
            "precision_at_3": r.precision_at_3,
            "avg_similarity": r.avg_similarity,
            "zero_result_rate": r.zero_result_rate,
            "gate_passed": r.gate_passed,
            "gate_reason": r.gate_reason,
        }
        for r in runs
    ]


# ── Human Review (votes) ───────────────────────────────────────

@router.post("/vote", status_code=201)
async def submit_vote(
    body: VoteIn,
    current_user: User = CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Submit a thumbs up (1) or thumbs down (-1) for a search result."""
    if body.vote not in (1, -1):
        raise HTTPException(400, "vote must be 1 (up) or -1 (down)")

    try:
        note_id = uuid.UUID(body.note_id)
    except ValueError:
        raise HTTPException(400, "Invalid note_id UUID")

    # Upsert — update if already voted
    existing = await db.execute(
        select(ResultVote).where(
            ResultVote.user_id == current_user.id,
            ResultVote.query_text == body.query_text,
            ResultVote.note_id == note_id,
        )
    )
    row = existing.scalar_one_or_none()

    if row:
        row.vote = body.vote
    else:
        row = ResultVote(
            user_id=current_user.id,
            query_text=body.query_text,
            note_id=note_id,
            vote=body.vote,
        )
        db.add(row)

    await db.commit()
    return {"message": "Vote recorded"}


# ── Admin Dashboard (company-wide, all users) ───────────────────

def _run_summary(r: EvalRun) -> dict:
    return {
        "id": str(r.id),
        "user_id": str(r.user_id),
        "created_at": r.created_at.isoformat(),
        "total_queries": r.total_queries,
        "precision_at_3": r.precision_at_3,
        "avg_similarity": r.avg_similarity,
        "zero_result_rate": r.zero_result_rate,
        "gate_passed": r.gate_passed,
        "gate_reason": r.gate_reason,
    }


@router.get("/admin/stats")
async def get_admin_stats(
    _admin: User = CurrentAdmin,
    db: AsyncSession = Depends(get_db),
):
    """
    Company-wide eval dashboard data — aggregates across ALL users.
    Admin-only (see CurrentAdmin / ADMIN_EMAILS).
    """
    # Last 20 eval runs across all users, newest first
    runs_result = await db.execute(
        select(EvalRun).order_by(EvalRun.created_at.desc()).limit(20)
    )
    runs = runs_result.scalars().all()
    runs_chrono = list(reversed(runs))  # oldest → newest, for trend charts

    latest = runs[0] if runs else None
    previous = runs[1] if len(runs) > 1 else None

    comparison = None
    if latest and previous:
        comparison = {
            "latest": _run_summary(latest),
            "previous": _run_summary(previous),
            "precision_at_3_delta": round(latest.precision_at_3 - previous.precision_at_3, 4),
            "avg_similarity_delta": round(latest.avg_similarity - previous.avg_similarity, 4),
            "zero_result_rate_delta": round(latest.zero_result_rate - previous.zero_result_rate, 4),
        }

    # Daily retrieval volume/quality — last 30 days, all users
    daily = await db.execute(
        text("""
            SELECT
                DATE(created_at) as day,
                COUNT(*) as queries,
                ROUND(AVG(avg_similarity)::numeric, 4) as avg_sim,
                ROUND(AVG(CASE WHEN notes_returned = 0 THEN 1 ELSE 0 END)::numeric, 4) as zero_rate
            FROM retrieval_logs
            WHERE created_at >= NOW() - INTERVAL '30 days'
            GROUP BY DATE(created_at)
            ORDER BY day ASC
        """)
    )
    daily_rows = daily.all()

    # Low-confidence queries — last 7 days, all users
    low_conf = await db.execute(
        text("""
            SELECT query_text, avg_similarity, notes_returned, created_at, user_id
            FROM retrieval_logs
            WHERE (avg_similarity < 0.55 OR notes_returned = 0)
              AND created_at >= NOW() - INTERVAL '7 days'
            ORDER BY created_at DESC
            LIMIT 30
        """)
    )
    low_conf_rows = low_conf.all()

    # Global vote tally
    votes = await db.execute(
        text("""
            SELECT
                SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END) as thumbs_up,
                SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) as thumbs_down
            FROM result_votes
        """)
    )
    vote_row = votes.one_or_none()

    # Most-downvoted (query, note) pairs — the actionable "what's broken" list
    downvoted = await db.execute(
        text("""
            SELECT rv.query_text, rv.note_id, n.title as note_title,
                   COUNT(*) as downvotes
            FROM result_votes rv
            LEFT JOIN notes n ON n.id = rv.note_id
            WHERE rv.vote = -1
            GROUP BY rv.query_text, rv.note_id, n.title
            ORDER BY downvotes DESC
            LIMIT 20
        """)
    )
    downvoted_rows = downvoted.all()

    # Total golden dataset size across all users
    golden_count = await db.execute(select(func.count()).select_from(EvalQuery))
    total_golden = golden_count.scalar_one()

    return {
        "run_comparison": comparison,
        "run_history": [_run_summary(r) for r in runs_chrono],
        "daily_logs": [
            {
                "day": str(r[0]),
                "queries": r[1],
                "avg_similarity": float(r[2]) if r[2] else None,
                "zero_result_rate": float(r[3]) if r[3] else None,
            }
            for r in daily_rows
        ],
        "low_confidence_queries": [
            {
                "query_text": r[0],
                "avg_similarity": float(r[1]) if r[1] else None,
                "notes_returned": r[2],
                "created_at": r[3].isoformat(),
                "user_id": str(r[4]),
            }
            for r in low_conf_rows
        ],
        "votes": {
            "thumbs_up": int(vote_row[0] or 0) if vote_row else 0,
            "thumbs_down": int(vote_row[1] or 0) if vote_row else 0,
        },
        "most_downvoted": [
            {
                "query_text": r[0],
                "note_id": str(r[1]),
                "note_title": r[2],
                "downvotes": r[3],
            }
            for r in downvoted_rows
        ],
        "total_golden_queries": total_golden,
    }


@router.get("/admin/users")
async def list_admin_users(
    _admin: User = CurrentAdmin,
    db: AsyncSession = Depends(get_db),
):
    """List all users with a note count, for the admin run-eval picker."""
    result = await db.execute(
        text("""
            SELECT u.id, u.email, u.username, COUNT(n.id) as note_count
            FROM users u
            LEFT JOIN notes n ON n.user_id = u.id
            GROUP BY u.id, u.email, u.username
            ORDER BY u.email ASC
        """)
    )
    rows = result.all()
    return [
        {
            "id": str(r[0]),
            "email": r[1],
            "username": r[2],
            "note_count": r[3],
        }
        for r in rows
    ]


async def _promote_upvotes_to_golden(user_id: uuid.UUID, db: AsyncSession) -> int:
    """Turn thumbs-up votes not already in the golden set into EvalQuery rows."""
    result = await db.execute(
        text("""
            SELECT rv.query_text, rv.note_id, n.title
            FROM result_votes rv
            JOIN notes n ON n.id = rv.note_id
            WHERE rv.user_id = CAST(:uid AS uuid) AND rv.vote = 1
              AND NOT EXISTS (
                  SELECT 1 FROM eval_queries eq
                  WHERE eq.user_id = rv.user_id
                    AND eq.query_text = rv.query_text
                    AND eq.expected_note_id = rv.note_id
              )
        """),
        {"uid": str(user_id)},
    )
    new_pairs = result.all()

    added = 0
    seen = set()
    for query_text_, note_id, note_title in new_pairs:
        key = (query_text_, note_id)
        if key in seen:
            continue
        seen.add(key)
        db.add(EvalQuery(
            query_text=query_text_,
            expected_note_id=note_id,
            expected_note_title=note_title,
            query_type="question",
            user_id=user_id,
        ))
        added += 1

    if added:
        await db.flush()
    return added


@router.post("/admin/run/{user_id}")
async def admin_trigger_run(
    user_id: uuid.UUID,
    _admin: User = CurrentAdmin,
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger an eval run on behalf of a specific user (admin-only).
    First promotes any thumbs-up votes not yet in the golden set into
    EvalQuery rows, then runs the offline eval against the full golden dataset.
    """
    target_user = await db.get(User, user_id)
    if not target_user:
        raise HTTPException(404, "User not found")

    promoted = await _promote_upvotes_to_golden(user_id, db)

    result = await db.execute(
        select(EvalQuery).where(EvalQuery.user_id == user_id)
    )
    golden = result.scalars().all()
    if not golden:
        raise HTTPException(400, f"No golden queries found for user {user_id} (and no thumbs-up votes to promote)")

    raw_results = []
    hit_count = 0
    all_similarities = []
    zero_result_count = 0

    for gq in golden:
        try:
            query_embedding = await get_embedding(gq.query_text)
        except Exception as e:
            raw_results.append({"query": gq.query_text, "error": str(e), "hit": False})
            continue

        rows = await db.execute(
            text("""
                SELECT id,
                       1 - (embedding <=> CAST(:emb AS vector)) as similarity
                FROM notes
                WHERE embedding IS NOT NULL
                  AND user_id = CAST(:uid AS uuid)
                  AND 1 - (embedding <=> CAST(:emb AS vector)) >= :threshold
                ORDER BY embedding <=> CAST(:emb AS vector)
                LIMIT 3
            """),
            {
                "emb": str(query_embedding),
                "uid": str(user_id),
                "threshold": settings.search_similarity_threshold,
            },
        )
        top_3 = rows.all()

        if not top_3:
            zero_result_count += 1
            raw_results.append({
                "query": gq.query_text,
                "expected_note_id": str(gq.expected_note_id),
                "returned_ids": [], "similarities": [],
                "hit": False, "zero_result": True,
            })
            continue

        returned_ids = [str(r[0]) for r in top_3]
        similarities = [round(float(r[1]), 4) for r in top_3]
        all_similarities.extend(similarities)

        hit = str(gq.expected_note_id) in returned_ids
        if hit:
            hit_count += 1

        raw_results.append({
            "query": gq.query_text,
            "expected_note_id": str(gq.expected_note_id),
            "expected_note_title": gq.expected_note_title,
            "returned_ids": returned_ids,
            "similarities": similarities,
            "hit": hit,
        })

    total = len(golden)
    precision_at_3 = round(hit_count / total, 4) if total > 0 else 0.0
    avg_similarity = round(sum(all_similarities) / len(all_similarities), 4) if all_similarities else 0.0
    zero_result_rate = round(zero_result_count / total, 4) if total > 0 else 0.0

    last_pass = await db.execute(
        select(EvalRun)
        .where(EvalRun.user_id == user_id, EvalRun.gate_passed == True)
        .order_by(EvalRun.created_at.desc())
        .limit(1)
    )
    baseline = last_pass.scalar_one_or_none()

    gate_passed = True
    gate_reason = None

    if baseline:
        if precision_at_3 < baseline.precision_at_3 - 0.05:
            gate_passed = False
            gate_reason = (
                f"Precision@3 dropped from {baseline.precision_at_3:.0%} "
                f"to {precision_at_3:.0%} — exceeds 5pp regression threshold"
            )
        elif avg_similarity < 0.55:
            gate_passed = False
            gate_reason = f"avg_similarity {avg_similarity:.3f} is below 0.55 floor"
        elif zero_result_rate > 0.20:
            gate_passed = False
            gate_reason = f"zero_result_rate {zero_result_rate:.0%} exceeds 20% ceiling"

    run = EvalRun(
        user_id=user_id,
        total_queries=total,
        precision_at_3=precision_at_3,
        avg_similarity=avg_similarity,
        zero_result_rate=zero_result_rate,
        gate_passed=gate_passed,
        gate_reason=gate_reason,
        raw_results=raw_results,
    )
    db.add(run)
    await db.commit()

    return {
        "run_id": str(run.id),
        "total_queries": total,
        "hits": hit_count,
        "precision_at_3": f"{precision_at_3:.0%}",
        "avg_similarity": avg_similarity,
        "zero_result_rate": f"{zero_result_rate:.0%}",
        "gate_passed": gate_passed,
        "gate_reason": gate_reason,
        "promoted_from_votes": promoted,
    }
