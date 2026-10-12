"""Client-ingest cache behaviour.

Regression guard: a transcript captured by the client (browser) must always be
reused by the processing pipeline, even when it carries a placeholder title.
Previously the title-integrity guard discarded it and the job fell back to
server yt-dlp, which fails on datacenter hosts (`ytdlp_failure`).
"""

from __future__ import annotations

import asyncio

from app.config import Settings
from app.models.schemas import IngestRequest
from app.services.cache import FileCache
from app.services.video_service import VideoService
from tests.conftest import (
    TEST_VIDEO_ID,
    FakeTranscriptProvider,
    ScriptedAIProvider,
    sample_meta,
)


class _OembedProvider(FakeTranscriptProvider):
    def __init__(self) -> None:
        super().__init__()
        self.oembed_calls = 0

    async def fetch_oembed_metadata(self, video_id: str):  # type: ignore[override]
        self.oembed_calls += 1
        return sample_meta().model_copy(update={"title": "Real oEmbed Title"})


def _settings(tmp_path, monkeypatch) -> Settings:
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CACHE_ENABLED", "true")
    return Settings(_env_file=None)


async def test_ingest_without_title_reuses_client_transcript(tmp_path, monkeypatch) -> None:
    settings = _settings(tmp_path, monkeypatch)
    cache = FileCache(settings)
    provider = _OembedProvider()
    service = VideoService(settings, cache, provider, ScriptedAIProvider())

    request = IngestRequest(
        title=None,
        kind="auto",
        format="segments",
        segments=[
            {"start": 0.0, "end": 3.0, "text": "first line of the talk"},
            {"start": 3.0, "end": 6.0, "text": "second line of the talk"},
        ],
    )
    await service.ingest(TEST_VIDEO_ID, request)
    for _ in range(10):
        await asyncio.sleep(0)

    # The yt-dlp transcript provider must never run for a client ingest.
    assert provider.calls == 0
    assert provider.oembed_calls == 1
    assert service._has_transcript_cache(TEST_VIDEO_ID) is True
    meta = cache.read_json(TEST_VIDEO_ID, "metadata")
    assert meta is not None and meta["title"] == "Real oEmbed Title"


def test_placeholder_title_cache_is_accepted(tmp_path, monkeypatch) -> None:
    settings = _settings(tmp_path, monkeypatch)
    cache = FileCache(settings)
    service = VideoService(settings, cache, FakeTranscriptProvider(), ScriptedAIProvider())

    cache.write_json(
        TEST_VIDEO_ID,
        "metadata",
        {
            "video_id": TEST_VIDEO_ID,
            "url": f"https://www.youtube.com/watch?v={TEST_VIDEO_ID}",
            "title": "Untitled video",
            "cache_version": settings.cache_version,
        },
    )
    cache.write_json(TEST_VIDEO_ID, "transcript", {"video_id": TEST_VIDEO_ID, "segments": []})
    cache.write_json(TEST_VIDEO_ID, "chunks", [{"index": 0, "start": 0, "end": 1, "text": "x"}])

    assert service._has_transcript_cache(TEST_VIDEO_ID) is True


def test_stale_cache_version_is_rejected(tmp_path, monkeypatch) -> None:
    settings = _settings(tmp_path, monkeypatch)
    cache = FileCache(settings)
    service = VideoService(settings, cache, FakeTranscriptProvider(), ScriptedAIProvider())

    cache.write_json(
        TEST_VIDEO_ID,
        "metadata",
        {
            "video_id": TEST_VIDEO_ID,
            "url": f"https://www.youtube.com/watch?v={TEST_VIDEO_ID}",
            "title": "Real title",
            "cache_version": settings.cache_version - 1,
        },
    )
    cache.write_json(TEST_VIDEO_ID, "transcript", {"video_id": TEST_VIDEO_ID, "segments": []})
    cache.write_json(TEST_VIDEO_ID, "chunks", [{"index": 0, "start": 0, "end": 1, "text": "x"}])

    assert service._has_transcript_cache(TEST_VIDEO_ID) is False
