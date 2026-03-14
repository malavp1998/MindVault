"""Run golden dataset insert + eval inside the backend container."""
import asyncio
import uuid
import json
import sys
sys.path.insert(0, "/app")

from database import async_session, init_db
from models import EvalQuery, EvalRun, Note
from services.embedding import get_embedding
from sqlalchemy import select, text
from config import get_settings

settings = get_settings()

USER_ID = uuid.UUID("7e4b50cb-03e4-4e84-8ff2-dfeadf8cea33")

GOLDEN = [
    {"query_text": "How does a web crawler system handle scalability and low latency?", "expected_note_id": "5a8081f8-d176-431a-b607-4181303d93c8", "expected_note_title": "Web Crawler System Design", "query_type": "question"},
    {"query_text": "What are the key challenges in designing a chat system like ChatGPT at scale?", "expected_note_id": "6a2505ac-014f-4b40-aa70-163634e28d87", "expected_note_title": "ChatGPT System Design - by Neo Kim and Hayk", "query_type": "question"},
    {"query_text": "How does WhatsApp handle stateful connections and database sharding at massive scale?", "expected_note_id": "fac6dc22-2d85-45a0-a573-40c7ec91fbee", "expected_note_title": "WhatsApp System Design Interview - by Neo Kim and Hayk", "query_type": "question"},
    {"query_text": "What are the consistency and concurrency challenges in designing a hotel booking system?", "expected_note_id": "27b4246b-d6d1-41c7-b7ee-9a2b654f8e2a", "expected_note_title": "Airbnb System Design - by Neo Kim and Hayk", "query_type": "question"},
    {"query_text": "How does YouTube handle exabyte-level video storage and adaptive delivery for millions of concurrent viewers?", "expected_note_id": "0c6c8db0-a3ff-4c51-9a71-ba95f8777a27", "expected_note_title": "YouTube System Design - by Neo Kim", "query_type": "question"},
    {"query_text": "What is an order book and how does a stock exchange match buyers and sellers in real time?", "expected_note_id": "6cff9b09-50c6-478d-816f-602a4c6d7fd9", "expected_note_title": "Stock Exchange System Design - by Neo Kim", "query_type": "question"},
    {"query_text": "How do large language models use transformers and attention mechanisms to predict the next word?", "expected_note_id": "a5b86dc9-4e45-4072-b1be-e508915eb905", "expected_note_title": "Large Language Models explained briefly", "query_type": "question"},
    {"query_text": "What is the difference between context engineering and prompt engineering?", "expected_note_id": "f3c532a5-606a-4972-b26a-c60f39b516b9", "expected_note_title": "Context Engineering vs Prompt Engineering", "query_type": "question"},
    {"query_text": "How should senior engineers evaluate agentic AI systems before deploying to production?", "expected_note_id": "99816ddb-2f18-4054-89a1-96ae870cfc41", "expected_note_title": "How Senior Engineers Evaluate Agentic AI Systems (Interview Question)", "query_type": "question"},
    {"query_text": "What framework should I use to prepare for a system design interview after failing one?", "expected_note_id": "96dadb3b-091c-4e90-8132-1c974ebeb94c", "expected_note_title": "How to Prepare for System Design Interview", "query_type": "question"},
    {"query_text": "What does Linus Torvalds think about artificial intelligence?", "expected_note_id": "20de9efa-d30e-4bb8-8f3e-e95063a82f81", "expected_note_title": "(8) Linus Torvalds on AI: Overhyped, Yet Inevitable", "query_type": "question"},
    {"query_text": "How does Model Context Protocol solve the N×M integration problem for AI models?", "expected_note_id": "eaf5044d-ae59-4153-9834-73ac30b76266", "expected_note_title": "How MCP Works - by Neo Kim and Hayk", "query_type": "question"},
    {"query_text": "two sum hash map O(n) solution leetcode", "expected_note_id": "0edc97e3-2f6e-4dda-be61-1e565993bbb5", "expected_note_title": "(7) This is the Most Asked FAANG Interview Question! - Two Sum - Leetcode 1", "query_type": "keyword"},
    {"query_text": "3sum two pointer technique leetcode Meta interview", "expected_note_id": "ac53b900-10eb-4f28-89f5-3354bc3b1970", "expected_note_title": "(28) Meta's Favorite Coding Question - 3Sum - Leetcode 15", "query_type": "keyword"},
    {"query_text": "DSA strategy crack Microsoft interview data structures algorithms", "expected_note_id": "830cc5d2-2bd0-4705-acec-631496be697d", "expected_note_title": "(1) If I had to crack Microsoft again, I would follow this DSA Strategy", "query_type": "keyword"},
    {"query_text": "Redis caching in-memory key-value store distributed systems", "expected_note_id": "61fd1141-6dcd-41dd-9b7f-af70f73fef83", "expected_note_title": "Redis - In Practice | Distributed Systems Deep Dives With Ex-Google SWE", "query_type": "keyword"},
    {"query_text": "gRPC protocol buffers HTTP2 REST alternative", "expected_note_id": "5d1afb58-fb41-43ed-949a-a3d008443b44", "expected_note_title": "(8) Why gRPC is Popular", "query_type": "keyword"},
    {"query_text": "Stripe payment gateway PCI DSS transactional outbox pattern", "expected_note_id": "2916500d-8070-446d-986d-50f1f5fc5ae5", "expected_note_title": "(8) Design Stripe | System Design Interview", "query_type": "keyword"},
    {"query_text": "rare earth elements China US strategic competition supply chain", "expected_note_id": "ce463294-3f63-421b-851c-9796fdd74da7", "expected_note_title": "Rare Earth Elements at the Forefront of Strategic Competition", "query_type": "keyword"},
    {"query_text": "Strait of Hormuz oil shipping disruption geopolitical risk", "expected_note_id": "9bca3c57-45f0-4ff8-96b7-2d442c4b3122", "expected_note_title": "The Global Costs of Instability in the Strait of Hormuz", "query_type": "keyword"},
    {"query_text": "something about common mistakes people make on coding platforms", "expected_note_id": "4b40e70d-beb5-445c-8d64-fe4fc8af7ee3", "expected_note_title": "4 Leetcode Mistakes", "query_type": "vague"},
    {"query_text": "notes about AI agents and how they work autonomously", "expected_note_id": "e78e4485-d972-4a98-ba5d-473eebcb5ba1", "expected_note_title": "Agentic AI", "query_type": "vague"},
    {"query_text": "stuff about how global connectivity and aviation affects trade and geopolitics", "expected_note_id": "af5552dd-dbe7-4e82-9838-7ae4201f02c6", "expected_note_title": "The Gulf's Drive for Omniconnectivity in a Fractured Middle East", "query_type": "vague"},
    {"query_text": "a personal note about someone's learning journey and goals", "expected_note_id": "32caeebf-121b-43c3-bdf8-fac3e0245ea2", "expected_note_title": "Mad man vinny in age of AI", "query_type": "vague"},
    {"query_text": "something about Google's internal storage system at massive scale", "expected_note_id": "239a3e15-5a4e-4b6c-99d2-ecdd2b82bd83", "expected_note_title": "Colossus: Google's File System", "query_type": "vague"},
    {"query_text": "how to design a large-scale chat messaging system", "expected_note_id": "fac6dc22-2d85-45a0-a573-40c7ec91fbee", "expected_note_title": "WhatsApp System Design Interview - by Neo Kim and Hayk", "query_type": "indic"},
    {"query_text": "agentic AI course evaluation evals deeplearning", "expected_note_id": "173f8161-5bb4-448d-8b3b-3aada4bc7228", "expected_note_title": "Agentic AI - DeepLearning.AI", "query_type": "indic"},
    {"query_text": "how AI agents fail in DevOps due to context window overflow", "expected_note_id": "a9e28ae7-500b-487d-8541-166ceae6dfb0", "expected_note_title": "Context Engineering is the Key to Unlocking AI Agents in DevOps - DevOps.com", "query_type": "indic"},
    {"query_text": "US technology diplomacy and AI infrastructure alliances with India", "expected_note_id": "36583c3a-1e66-4212-bd89-4a2984003ee0", "expected_note_title": "Why Technology Alliances Matter: AI Diffusion", "query_type": "indic"},
    {"query_text": "music streaming system design adaptive bitrate search royalties polyclot persistence", "expected_note_id": "ab417724-7f44-42f4-af6b-56e5082ee937", "expected_note_title": "Design Spotify | System Design Interview", "query_type": "indic"},
]


async def main():
    await init_db()

    # Step 1: Insert golden dataset
    async with async_session() as db:
        inserted = 0
        for q in GOLDEN:
            note_id = uuid.UUID(q["expected_note_id"])
            note = await db.get(Note, note_id)
            if not note:
                print(f"⚠️  Note not found: {q['expected_note_title']} ({q['expected_note_id']})")
                continue

            row = EvalQuery(
                query_text=q["query_text"],
                expected_note_id=note_id,
                expected_note_title=q["expected_note_title"],
                query_type=q["query_type"],
                user_id=USER_ID,
            )
            db.add(row)
            inserted += 1
        await db.commit()
        print(f"\n✅ Inserted {inserted} golden queries\n")

    # Step 2: Run eval
    async with async_session() as db:
        result = await db.execute(
            select(EvalQuery).where(EvalQuery.user_id == USER_ID)
        )
        golden = result.scalars().all()
        print(f"📊 Running eval on {len(golden)} queries...\n")

        raw_results = []
        hit_count = 0
        all_similarities = []
        zero_result_count = 0

        for i, gq in enumerate(golden, 1):
            try:
                query_embedding = await get_embedding(gq.query_text)
            except Exception as e:
                print(f"  [{i}] ❌ Embedding failed: {gq.query_text[:50]}... — {e}")
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
                    "uid": str(USER_ID),
                    "threshold": settings.search_similarity_threshold,
                },
            )
            top_3 = rows.all()

            if not top_3:
                zero_result_count += 1
                print(f"  [{i}] 🔍 ZERO results: {gq.query_text[:60]}...")
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
                print(f"  [{i}] ✅ HIT   sim={similarities[0]:.4f}  {gq.query_text[:60]}...")
            else:
                print(f"  [{i}] ❌ MISS  sim={similarities[0]:.4f}  {gq.query_text[:60]}...")

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

        # First run — always passes
        gate_passed = True
        gate_reason = None

        run = EvalRun(
            user_id=USER_ID,
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

        print(f"\n{'='*60}")
        print(f"  📊 EVAL RESULTS")
        print(f"{'='*60}")
        print(f"  Total queries:     {total}")
        print(f"  Hits (top-3):      {hit_count}")
        print(f"  Precision@3:       {precision_at_3:.0%}")
        print(f"  Avg similarity:    {avg_similarity:.4f}")
        print(f"  Zero-result rate:  {zero_result_rate:.0%}")
        print(f"  Gate passed:       {'✅ YES' if gate_passed else '❌ NO'}")
        if gate_reason:
            print(f"  Gate reason:       {gate_reason}")
        print(f"  Run ID:            {run.id}")
        print(f"{'='*60}")


if __name__ == "__main__":
    asyncio.run(main())
