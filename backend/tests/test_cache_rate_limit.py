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
