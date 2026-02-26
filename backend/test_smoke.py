#!/usr/bin/env python3
"""
MindVault smoke test — runs against a live backend at http://localhost:8000.
Usage: python test_smoke.py
"""
import asyncio
import httpx
import sys

BASE = "http://localhost:8000"


async def run():
    async with httpx.AsyncClient(base_url=BASE, timeout=30) as client:
        # 1. Health check
        r = await client.get("/health")
        assert r.status_code == 200, f"Health check failed: {r.text}"
        print("✅ Health check passed")

        # 2. Create a note
        r = await client.post("/api/notes", json={
            "title": "Test Note — The Transformer Architecture",
            "content": (
                "The Transformer is a deep learning architecture that relies entirely "
                "on self-attention mechanisms, dispensing with recurrence and convolutions. "
                "It was introduced in the 2017 paper 'Attention Is All You Need' by Vaswani et al. "
                "The architecture uses multi-head attention, positional encoding, and feed-forward layers."
            ),
            "tags": ["ai", "transformers", "ml"],
            "source_url": "https://arxiv.org/abs/1706.03762",
        })
        assert r.status_code == 201, f"Create note failed: {r.text}"
        note = r.json()
        note_id = note["id"]
        print(f"✅ Note created: {note_id}")

        # 3. Get the note back
        r = await client.get(f"/api/notes/{note_id}")
        assert r.status_code == 200, f"Get note failed: {r.text}"
        print("✅ Note retrieved")

        # 4. List notes
        r = await client.get("/api/notes")
        assert r.status_code == 200
        notes = r.json()
        assert len(notes) >= 1
        print(f"✅ Listed {len(notes)} note(s)")

        # 5. Trigger processing manually (AI pipeline)
        r = await client.post(f"/api/notes/{note_id}/process")
        assert r.status_code == 202, f"Process trigger failed: {r.text}"
        print("✅ AI processing triggered")

        # Wait a moment for background processing
        await asyncio.sleep(5)

        # 6. Semantic search (requires embedding to be stored)
        r = await client.get("/api/notes/search", params={"q": "transformer attention mechanism"})
        assert r.status_code == 200
        search_data = r.json()
        print(f"✅ Semantic search returned {len(search_data['results'])} result(s)")

        # 7. RAG search
        r = await client.get("/api/notes/search", params={
            "q": "How does the transformer attention mechanism work?",
            "synthesize": "true",
        })
        assert r.status_code == 200
        rag_data = r.json()
        if rag_data.get("rag"):
            print(f"✅ RAG synthesis: {rag_data['rag']['answer'][:100]}...")
        else:
            print("⚠️  RAG synthesis skipped (LLM may not be ready yet)")

        # 8. Topics list
        r = await client.get("/api/topics")
        assert r.status_code == 200
        print(f"✅ Topics: {len(r.json())} topic(s)")

        # 9. Related notes by URL
        r = await client.get("/api/notes/related", params={
            "url": "https://arxiv.org/abs/1706.03762"
        })
        assert r.status_code == 200
        print(f"✅ Related notes by URL: {len(r.json()['notes'])} result(s)")

        # 10. Delete the test note
        r = await client.delete(f"/api/notes/{note_id}")
        assert r.status_code == 204, f"Delete failed: {r.text}"
        print("✅ Note deleted")

        print("\n🎉 All smoke tests passed!")


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except Exception as e:
        print(f"\n❌ Smoke test failed: {e}")
        sys.exit(1)
