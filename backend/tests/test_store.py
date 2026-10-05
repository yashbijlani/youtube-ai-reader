"""Storage layer tests: memory store plus Supabase client/repository (no network)."""

from __future__ import annotations

import httpx

from app.services.store.memory_store import MemoryStore
from app.services.store.supabase_client import SupabaseClient
from app.services.store.supabase_store import SupabaseStore

VIDEO = "dQw4w9WgXcQ"


async def test_memory_store_video_roundtrip() -> None:
    store = MemoryStore()
    await store.save_video(
        VIDEO,
        status="transcript_ready",
        metadata={"video_id": VIDEO, "title": "T", "channel": "C", "duration": 30.0},
        transcript={"video_id": VIDEO, "language": "en", "kind": "manual", "segments": [{"start": 0, "end": 1, "text": "hi"}]},
        chunks=[{"index": 0, "start": 0, "end": 1, "text": "hi"}],
    )
    bundle = await store.load_video(VIDEO)
    assert bundle is not None
    assert bundle["metadata"]["title"] == "T"
    assert bundle["chunks"][0]["text"] == "hi"
    await store.save_video(VIDEO, analysis={"overview": "O", "key_points": [], "chapters": [], "detailed_reading": "R"})
    bundle = await store.load_video(VIDEO)
    assert bundle["analysis"]["overview"] == "O"


async def test_memory_store_user_quota_subscription_webhooks() -> None:
    store = MemoryStore()
    user = await store.ensure_user("u1", "a@b.com")
    assert user["plan"] == "free"
    await store.ensure_user("u1")
    assert len(store.users) == 1

    assert await store.get_used_videos("u1") == set()
    await store.add_used_video("u1", VIDEO)
    await store.add_used_video("u1", VIDEO)
    assert await store.get_used_videos("u1") == {VIDEO}

    usage = await store.increment_period_usage("u1", "2026-10", videos=1, ai_cost_usd=0.01)
    assert usage["videos_used"] == 1
    assert usage["ai_cost_usd"] == 0.01

    sub = await store.upsert_subscription("u1", {"status": "ACTIVE", "provider_subscription_id": "sub_1"})
    assert sub["status"] == "ACTIVE"
    assert (await store.get_subscription("u1"))["provider_subscription_id"] == "sub_1"

    assert await store.mark_webhook_processed("evt_1", "razorpay", "payment.captured") is True
    assert await store.mark_webhook_processed("evt_1", "razorpay", "payment.captured") is False


async def test_memory_store_chat() -> None:
    store = MemoryStore()
    await store.append_chat_message("u1", VIDEO, role="user", content="q?")
    await store.append_chat_message("u1", VIDEO, role="assistant", content="a!", model="m")
    messages = await store.list_chat_messages("u1", VIDEO)
    assert [m["role"] for m in messages] == ["user", "assistant"]
    await store.clear_chat("u1", VIDEO)
    assert await store.list_chat_messages("u1", VIDEO) == []


class RecordingTransport(httpx.MockTransport):
    pass


async def test_supabase_client_sends_service_key_and_filters() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[])

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    supa = SupabaseClient("https://proj.supabase.co", "service-key", client=client)
    await supa.select("videos", columns="id,status", filters=[("status", "eq", "ready"), ("id", "in", ["a", "b"])], params={"limit": "5"})
    sent = seen[0]
    assert sent.headers["apikey"] == "service-key"
    assert sent.headers["Authorization"] == "Bearer service-key"
    query = str(sent.url)
    assert "status=eq.ready" in query and "id=in.%28a%2Cb%29" in query and "limit=5" in query
    await client.aclose()


async def test_supabase_store_load_video_assembles_bundle() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "/videos" in url:
            return httpx.Response(200, json={"id": VIDEO, "status": "ready", "title": "T", "metadata": {"channel": "C"}})
        if "/transcripts" in url:
            return httpx.Response(200, json={"video_id": VIDEO, "language": "en", "kind": "manual", "source": "browser_intercept", "segments": [{"start": 0, "end": 1, "text": "hi"}]})
        if "/video_chunks" in url:
            return httpx.Response(200, json=[{"idx": 0, "start_s": 0, "end_s": 1, "text": "hi"}])
        if "/video_analysis" in url:
            return httpx.Response(200, json={"overview": "O", "key_points": [], "chapters": [], "detailed_reading": "R", "quick_read": "Q"})
        return httpx.Response(404, json=[])

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    store = SupabaseStore(SupabaseClient("https://proj.supabase.co", "k", client=client))
    bundle = await store.load_video(VIDEO)
    assert bundle is not None
    assert bundle["metadata"]["title"] == "T"
    assert bundle["transcript"]["segments"][0]["text"] == "hi"
    assert bundle["chunks"][0]["text"] == "hi"
    assert bundle["analysis"]["overview"] == "O"
    assert bundle["transcript_source"]["source"] == "browser_intercept"
    await client.aclose()


async def test_supabase_store_save_video_upserts_normalized_tables() -> None:
    calls: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        if request.method == "DELETE":
            return httpx.Response(204)
        return httpx.Response(200, json=[{}])

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    store = SupabaseStore(SupabaseClient("https://proj.supabase.co", "k", client=client))
    await store.save_video(
        VIDEO,
        status="transcript_ready",
        metadata={"title": "T"},
        transcript={"language": "en", "kind": "manual", "source": "browser_intercept", "segments": [{"text": "x"}]},
        chunks=[{"index": 0, "start": 0, "end": 1, "text": "x"}],
    )
    paths = [p for _, p in calls]
    assert "/rest/v1/videos" in paths
    assert "/rest/v1/transcripts" in paths
    assert "/rest/v1/video_chunks" in paths
    assert any(m == "DELETE" for m, _ in calls)
    await client.aclose()


async def test_supabase_store_duplicate_webhook_returns_false() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"message": "duplicate key value violates unique constraint"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    store = SupabaseStore(SupabaseClient("https://proj.supabase.co", "k", client=client))
    assert await store.mark_webhook_processed("evt", "razorpay", "payment.captured") is False
    await client.aclose()


async def test_config_selects_memory_store_without_supabase() -> None:
    from app.config import Settings
    from app.services.store import create_store

    settings = Settings(_env_file=None)
    store = create_store(settings)
    assert isinstance(store, MemoryStore)
    assert settings.use_supabase_storage is False

    settings.supabase_url = "https://proj.supabase.co"
    settings.supabase_service_role_key = "k"
    assert settings.use_supabase_storage is True
    supa = create_store(settings)
    assert isinstance(supa, SupabaseStore)
