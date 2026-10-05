"""End-to-end API tests with a real pipeline and scripted AI provider."""

from __future__ import annotations

import json
import time

from fastapi.testclient import TestClient

from app.errors import VideoUnavailable
from app.services.cache import FileCache
from tests.conftest import TEST_VIDEO_ID, FakeTranscriptProvider

VIDEO_URL = f"https://www.youtube.com/watch?v={TEST_VIDEO_ID}"


def wait_for_state(client: TestClient, video_id: str, timeout: float = 8.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        response = client.get(f"/api/videos/{video_id}")
        assert response.status_code == 200, response.text
        data = response.json()
        if data["status"] in ("ready", "error"):
            return data
        time.sleep(0.05)
    raise AssertionError("video did not finish processing in time")


def wait_for_guide(client: TestClient, video_id: str, timeout: float = 8.0) -> dict:
    """Wait until the reading guide (or a guide error) is final."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        response = client.get(f"/api/videos/{video_id}")
        assert response.status_code == 200, response.text
        data = response.json()
        if data["status"] == "error":
            return data
        if data["status"] == "ready" and data.get("analysis_status") in ("ready", "error"):
            return data
        time.sleep(0.05)
    raise AssertionError("reading guide did not finish in time")


def test_health(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["ai_configured"] is True


def test_process_rejects_non_youtube_urls(client: TestClient) -> None:
    response = client.post("/api/videos/process", json={"youtube_url": "https://example.com/x"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_youtube_url"


def test_process_flow_and_analysis(client: TestClient) -> None:
    response = client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    assert response.status_code == 200
    body = response.json()
    assert body["video_id"] == TEST_VIDEO_ID
    assert body["status"] in ("processing", "ready")

    state = wait_for_guide(client, TEST_VIDEO_ID)
    assert state["status"] == "ready", state
    assert state["analysis_status"] == "ready"
    assert state["metadata"]["title"] == "How AI Changes Software"
    analysis = state["analysis"]
    assert analysis["overview"]
    assert len(analysis["key_points"]) == 2
    assert analysis["key_points"][0]["start_seconds"] == 14
    assert len(analysis["chapters"]) == 2
    assert analysis["detailed_reading"]
    assert state["cached"] is False


def test_second_process_uses_cache_and_skips_ai(client: TestClient) -> None:
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    wait_for_guide(client, TEST_VIDEO_ID)
    calls_before = len(client.fake_ai.calls)  # type: ignore[attr-defined]

    response = client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["cached"] is True
    assert len(client.fake_ai.calls) == calls_before  # type: ignore[attr-defined]
    assert client.fake_transcript.calls == 1  # type: ignore[attr-defined]


def test_transcript_endpoints(client: TestClient) -> None:
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    wait_for_state(client, TEST_VIDEO_ID)

    response = client.get(f"/api/videos/{TEST_VIDEO_ID}/transcript")
    assert response.status_code == 200
    body = response.json()
    assert body["language"] == "en"
    assert body["segments"][0]["start"] == 0.0
    assert "Welcome" in body["segments"][0]["text"]

    text = client.get(f"/api/videos/{TEST_VIDEO_ID}/transcript?format=text")
    assert text.status_code == 200
    assert "[0:00]" in text.text


def test_transcript_missing_returns_404(client: TestClient) -> None:
    response = client.get("/api/videos/aaaaaaaaaaa/transcript")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "video_not_processed"


def test_chat_returns_answer_with_citations(client: TestClient) -> None:
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    wait_for_state(client, TEST_VIDEO_ID)

    response = client.post(
        f"/api/videos/{TEST_VIDEO_ID}/chat",
        json={"message": "Why does AI change programming?", "history": []},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["answer"]
    assert body["citations"]
    assert body["citations"][0]["start_seconds"] == 8.0
    assert body["usage"]["model"] == "scripted-test-model"


def test_chat_streaming_sse(client: TestClient) -> None:
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    wait_for_state(client, TEST_VIDEO_ID)

    response = client.post(
        f"/api/videos/{TEST_VIDEO_ID}/chat",
        json={"message": "What changes?", "stream": True},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    body = response.text
    assert '"type": "delta"' in body
    assert '"type": "done"' in body
    assert "0:08" in body


def test_chat_before_processing(client: TestClient) -> None:
    response = client.post("/api/videos/bbbbbbbbbbb/chat", json={"message": "hi"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "video_not_processed"


def test_chat_rate_limit(client: TestClient) -> None:
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    wait_for_state(client, TEST_VIDEO_ID)
    service = client.service  # type: ignore[attr-defined]
    service.settings.rate_limit_chat_per_hour = 2
    for _ in range(2):
        response = client.post(f"/api/videos/{TEST_VIDEO_ID}/chat", json={"message": "hi"})
        assert response.status_code == 200
    response = client.post(f"/api/videos/{TEST_VIDEO_ID}/chat", json={"message": "hi"})
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "rate_limited"


def test_transcript_unavailable_yields_friendly_error(
    client: TestClient, settings
) -> None:
    service = client.service  # type: ignore[attr-defined]
    service.transcript_provider = FakeTranscriptProvider(error=VideoUnavailable())
    response = client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    assert response.status_code == 200
    state = wait_for_state(client, TEST_VIDEO_ID)
    assert state["status"] == "error"
    assert state["error"]["code"] == "video_unavailable"
    assert "unavailable" in state["error"]["message"].lower()


def test_malformed_ai_output_degrades_guide_not_chat(client: TestClient) -> None:
    from tests.conftest import ScriptedAIProvider

    broken = ScriptedAIProvider(broken_json=True)
    service = client.service  # type: ignore[attr-defined]
    service.ai_provider = broken
    service.reader.provider = broken
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    state = wait_for_guide(client, TEST_VIDEO_ID)
    # The reading still generated, so the guide is ready but flagged degraded.
    assert state["status"] == "ready"
    assert state["analysis_status"] == "ready"
    assert state["analysis"]["degraded"] is True


def test_guide_failure_keeps_chat_available(client: TestClient) -> None:
    from tests.conftest import ScriptedAIProvider

    failing = ScriptedAIProvider(fail=True)
    service = client.service  # type: ignore[attr-defined]
    service.ai_provider = failing
    service.reader.provider = failing
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    state = wait_for_guide(client, TEST_VIDEO_ID)
    assert state["status"] == "ready"
    assert state["analysis_status"] == "error"
    assert state["error"] is None


def test_chat_is_ready_before_guide_finishes(client: TestClient) -> None:
    from tests.conftest import SlowAIProvider

    slow = SlowAIProvider(delay=0.7)
    service = client.service  # type: ignore[attr-defined]
    service.ai_provider = slow
    service.reader.provider = slow
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})

    state = wait_for_state(client, TEST_VIDEO_ID)
    assert state["status"] == "ready"
    assert state["analysis_status"] in ("pending", "partial")
    assert state["transcript_available"] is True

    # Chat already works while the guide is still being written.
    response = client.post(
        f"/api/videos/{TEST_VIDEO_ID}/chat", json={"message": "What is this about?"}
    )
    assert response.status_code == 200
    assert response.json()["answer"]

    final = wait_for_guide(client, TEST_VIDEO_ID)
    assert final["analysis_status"] == "ready"


def test_summarize_streams_from_transcript(client: TestClient) -> None:
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    wait_for_state(client, TEST_VIDEO_ID)
    response = client.post(f"/api/videos/{TEST_VIDEO_ID}/summarize")
    assert response.status_code == 200
    body = response.text
    assert '"type": "delta"' in body
    assert '"type": "done"' in body


def test_analysis_stream_replays_cached_guide(client: TestClient) -> None:
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    wait_for_guide(client, TEST_VIDEO_ID)
    response = client.get(f"/api/videos/{TEST_VIDEO_ID}/analysis/stream")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    body = response.text
    assert '"part": "overview"' in body
    assert '"type": "reading"' in body or '"type": "reading_section"' in body
    assert '"type": "done"' in body


def test_analysis_stream_emits_live_tokens(client: TestClient) -> None:
    from tests.conftest import SlowAIProvider

    slow = SlowAIProvider(delay=0.7)
    service = client.service  # type: ignore[attr-defined]
    service.ai_provider = slow
    service.reader.provider = slow
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    wait_for_state(client, TEST_VIDEO_ID)

    response = client.get(f"/api/videos/{TEST_VIDEO_ID}/analysis/stream")
    assert response.status_code == 200
    body = response.text
    assert '"type": "reading_delta"' in body
    assert '"type": "done"' in body
    final = wait_for_guide(client, TEST_VIDEO_ID)
    assert final["analysis_status"] == "ready"


def test_cancel_stops_in_flight_job(client: TestClient) -> None:
    from tests.conftest import SlowAIProvider

    slow = SlowAIProvider(delay=0.7)
    service = client.service  # type: ignore[attr-defined]
    service.ai_provider = slow
    service.reader.provider = slow
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    wait_for_state(client, TEST_VIDEO_ID)

    response = client.post(f"/api/videos/{TEST_VIDEO_ID}/cancel")
    assert response.status_code == 200
    assert response.json()["ok"] is True

    state = client.get(f"/api/videos/{TEST_VIDEO_ID}").json()
    assert state["status"] in ("idle", "ready")


def test_analysis_stream_before_transcript_is_rejected(client: TestClient) -> None:
    response = client.get("/api/videos/ccccccccccc/analysis/stream")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "video_not_processed"


INSTALL_HEADER = {"X-Install-Id": "install-test-1234"}
FREE_IDS = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"]


def _process(client: TestClient, video_id: str, headers=None) -> int:
    return client.post(
        "/api/videos/process",
        json={"youtube_url": f"https://www.youtube.com/watch?v={video_id}"},
        headers=INSTALL_HEADER if headers is None else headers,
    ).status_code


def test_free_limit_blocks_fourth_video(client: TestClient) -> None:
    for video_id in FREE_IDS[:3]:
        assert _process(client, video_id) == 200
    blocked = client.post(
        "/api/videos/process",
        json={"youtube_url": f"https://www.youtube.com/watch?v={FREE_IDS[3]}"},
        headers=INSTALL_HEADER,
    )
    assert blocked.status_code == 402
    assert blocked.json()["error"]["code"] == "free_limit_reached"


def test_free_limit_counts_repeat_once(client: TestClient) -> None:
    for _ in range(4):
        assert _process(client, FREE_IDS[0]) == 200
    # A different video is still available.
    assert _process(client, FREE_IDS[1]) == 200


def test_entitlement_bypasses_free_limit(client: TestClient) -> None:
    for video_id in FREE_IDS[:3]:
        assert _process(client, video_id) == 200
    response = client.post(
        "/api/entitlement", json={"paid": True, "email": "user@example.com"}, headers=INSTALL_HEADER
    )
    assert response.status_code == 200
    assert response.json()["paid"] is True
    assert _process(client, FREE_IDS[3]) == 200


def test_usage_endpoint(client: TestClient) -> None:
    _process(client, FREE_IDS[0])
    body = client.get("/api/usage", headers=INSTALL_HEADER).json()
    assert body["used"] == 1
    assert body["limit"] == 3
    assert body["remaining"] == 2
    assert body["paid"] is False


def test_no_install_id_is_unrestricted(client: TestClient) -> None:
    for video_id in FREE_IDS:
        assert _process(client, video_id, headers={}) == 200


def test_entitlement_requires_install_id(client: TestClient) -> None:
    response = client.post("/api/entitlement", json={"paid": True})
    assert response.status_code == 400


def test_ingest_accepts_client_transcript(client: TestClient) -> None:
    json3 = json.dumps(
        {
            "events": [
                {"tStartMs": 0, "dDurationMs": 2000, "segs": [{"utf8": "Welcome to the talk."}]},
                {"tStartMs": 2000, "dDurationMs": 2000, "segs": [{"utf8": "AI changes coding."}]},
                {"tStartMs": 4000, "dDurationMs": 2000, "segs": [{"utf8": "Judgment matters."}]},
            ]
        }
    )
    response = client.post(
        f"/api/videos/{TEST_VIDEO_ID}/ingest",
        json={
            "title": "Client Video",
            "channel": "Someone",
            "duration": 32.0,
            "language": "en",
            "kind": "manual",
            "format": "json3",
            "content": json3,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ready"
    assert body["transcript_available"] is True
    transcript = client.get(f"/api/videos/{TEST_VIDEO_ID}/transcript").json()
    assert transcript["segments"][0]["text"].startswith("Welcome")
    guide = wait_for_guide(client, TEST_VIDEO_ID)
    assert guide["analysis_status"] == "ready"


def test_ingest_rejects_empty_transcript(client: TestClient) -> None:
    response = client.post(
        f"/api/videos/{TEST_VIDEO_ID}/ingest",
        json={"format": "segments", "segments": []},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transcript_unavailable"


def test_repair_regenerates_guide(client: TestClient) -> None:
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    wait_for_guide(client, TEST_VIDEO_ID)
    response = client.post(f"/api/videos/{TEST_VIDEO_ID}/repair")
    assert response.status_code == 200
    assert response.json()["analysis_status"] in ("pending", "partial")
    guide = wait_for_guide(client, TEST_VIDEO_ID)
    assert guide["analysis_status"] == "ready"
    assert guide["analysis"]["overview"]


def test_analysis_stream_includes_quick_read(client: TestClient) -> None:
    from tests.conftest import SlowAIProvider

    slow = SlowAIProvider(delay=0.5)
    service = client.service  # type: ignore[attr-defined]
    service.ai_provider = slow
    service.reader.provider = slow
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    wait_for_state(client, TEST_VIDEO_ID)
    response = client.get(f"/api/videos/{TEST_VIDEO_ID}/analysis/stream")
    assert response.status_code == 200
    assert '"type": "quick_read' in response.text


def test_terminal_provider_error_returns_funding_error(client: TestClient) -> None:
    from app.errors import AIFundingError
    from tests.conftest import PreflightFailProvider

    provider = PreflightFailProvider(AIFundingError())
    service = client.service  # type: ignore[attr-defined]
    service.ai_provider = provider
    service.reader.provider = provider
    response = client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    assert response.status_code == 402
    assert response.json()["error"]["code"] == "ai_insufficient_funds"


def test_fast_model_used_for_guide_but_not_reading(client: TestClient) -> None:
    service = client.service  # type: ignore[attr-defined]
    service.settings.opencode_fast_model = "fast-model"
    service.reader.fast_model = "fast-model"
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    wait_for_guide(client, TEST_VIDEO_ID)
    models = client.fake_ai.models  # type: ignore[attr-defined]
    assert models.count("fast-model") >= 2  # overview + chapters
    assert None in models  # the detailed reading uses the main model


def test_reprocess_rebuilds_analysis(client: TestClient) -> None:
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    wait_for_guide(client, TEST_VIDEO_ID)
    response = client.post(f"/api/videos/{TEST_VIDEO_ID}/reprocess")
    assert response.status_code == 200
    state = wait_for_guide(client, TEST_VIDEO_ID)
    assert state["status"] == "ready"
    assert state["analysis"]["overview"]


def test_reprocess_rejected_while_processing(client: TestClient) -> None:
    service = client.service  # type: ignore[attr-defined]
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    # Force a slow transcript fetch to observe the "processing" window.
    service._run_job  # noqa: B018 - attribute exists
    response = client.post(f"/api/videos/{TEST_VIDEO_ID}/reprocess")
    assert response.status_code in (200, 409)
    wait_for_state(client, TEST_VIDEO_ID)


def test_cors_allows_chrome_extension_origin(client: TestClient) -> None:
    response = client.options(
        "/api/videos/process",
        headers={
            "Origin": "chrome-extension://abcdefghijklmnop",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") in (
        "chrome-extension://abcdefghijklmnop",
        "*",
    )


def test_cors_rejects_random_origin(client: TestClient) -> None:
    response = client.options(
        "/api/videos/process",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.headers.get("access-control-allow-origin") is None


def test_stats_endpoint(client: TestClient) -> None:
    response = client.get("/api/stats")
    assert response.status_code == 200
    assert "ai_calls" in response.json()


def test_cache_written_to_filesystem(client: TestClient, settings) -> None:
    client.post("/api/videos/process", json={"youtube_url": VIDEO_URL})
    wait_for_guide(client, TEST_VIDEO_ID)
    cache = FileCache(settings)
    assert cache.read_json(TEST_VIDEO_ID, "metadata") is not None
    assert cache.read_json(TEST_VIDEO_ID, "transcript") is not None
    assert cache.read_json(TEST_VIDEO_ID, "analysis") is not None
    assert cache.read_json(TEST_VIDEO_ID, "analysis_overview") is not None
    assert cache.read_json(TEST_VIDEO_ID, "analysis_reading") is not None
