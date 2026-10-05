"""Cache and rate limiting tests."""

from __future__ import annotations

import pytest

from app.config import Settings
from app.errors import RateLimited
from app.services.cache import FileCache
from app.services.rate_limit import SlidingWindowLimiter


def test_cache_roundtrip(settings: Settings) -> None:
    cache = FileCache(settings)
    cache.write_json("dQw4w9WgXcQ", "metadata", {"title": "hi"})
    assert cache.read_json("dQw4w9WgXcQ", "metadata") == {"title": "hi"}
    cache.delete("dQw4w9WgXcQ", "metadata")
    assert cache.read_json("dQw4w9WgXcQ", "metadata") is None


def test_cache_rejects_unsafe_video_ids(settings: Settings) -> None:
    cache = FileCache(settings)
    with pytest.raises(ValueError):
        cache.write_json("../../etc/passwd", "metadata", {"x": 1})
    with pytest.raises(ValueError):
        cache.read_json("a/b", "metadata")


def test_cache_disabled(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("CACHE_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    settings = Settings(_env_file=None)
    cache = FileCache(settings)
    cache.write_json("dQw4w9WgXcQ", "metadata", {"x": 1})
    assert cache.read_json("dQw4w9WgXcQ", "metadata") is None


def test_rate_limiter_blocks_after_limit() -> None:
    limiter = SlidingWindowLimiter()
    for _ in range(3):
        limiter.check("chat:1.2.3.4", 3, 60)
    with pytest.raises(RateLimited):
        limiter.check("chat:1.2.3.4", 3, 60)


def test_rate_limiter_separate_keys() -> None:
    limiter = SlidingWindowLimiter()
    limiter.check("chat:1.1.1.1", 1, 60)
    limiter.check("chat:2.2.2.2", 1, 60)
    with pytest.raises(RateLimited):
        limiter.check("chat:1.1.1.1", 1, 60)


VID = "dQw4w9WgXcQ"


def _seed_entry(cache: FileCache, metadata: dict, overview: str) -> None:
    cache.write_json(VID, "metadata", metadata)
    cache.write_json(VID, "transcript", {"video_id": VID, "language": "en", "kind": "auto", "segments": [{"start": 0, "end": 1, "text": "x"}]})
    cache.write_json(VID, "chunks", [{"index": 0, "start": 0, "end": 1, "text": "x"}])
    cache.write_json(VID, "analysis", {"analysis": {"overview": overview, "key_points": [], "chapters": [], "detailed_reading": ""}})


def test_stale_or_bad_cache_is_ignored(tmp_path, monkeypatch) -> None:
    from app.services.video_service import VideoService
    from tests.conftest import FakeTranscriptProvider, ScriptedAIProvider

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CACHE_ENABLED", "true")
    settings = Settings(_env_file=None)
    cache = FileCache(settings)
    service = VideoService(settings, cache, FakeTranscriptProvider(), ScriptedAIProvider())

    # Poisoned entry from the old bug: no cache_version and a placeholder title.
    _seed_entry(cache, {"video_id": VID, "url": f"https://www.youtube.com/watch?v={VID}", "title": "Untitled video"}, "chess")
    assert service._has_transcript_cache(VID) is False
    assert service.get_state(VID).status == "idle"

    # A current-version entry with a real title is served.
    _seed_entry(
        cache,
        {"video_id": VID, "url": f"https://www.youtube.com/watch?v={VID}", "title": "Real title", "cache_version": settings.cache_version},
        "ok",
    )
    assert service._has_transcript_cache(VID) is True
    state = service.get_state(VID)
    assert state.status == "ready"
    assert state.analysis is not None and state.analysis.overview == "ok"
