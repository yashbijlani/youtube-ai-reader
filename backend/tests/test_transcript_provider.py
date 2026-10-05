"""Transcript provider hardening tests (single call, 429, fallback, cookies)."""

from __future__ import annotations

import sys
import types
from pathlib import Path

from app.config import Settings
from app.errors import YouTubeRateLimited
from app.services.transcript import (
    YtDlpTranscriptProvider,
    _is_rate_limited,
    _map_ytdlp_error,
)


def test_rate_limit_detection() -> None:
    assert _is_rate_limited("ERROR: HTTP Error 429: Too Many Requests")
    assert _is_rate_limited("rate limit exceeded")
    assert not _is_rate_limited("Video unavailable")


def test_map_error_prefers_rate_limit() -> None:
    error = _map_ytdlp_error("Unable to download video subtitles for 'en': HTTP Error 429")
    assert isinstance(error, YouTubeRateLimited)


def test_base_args_include_cookies_and_client(settings: Settings) -> None:
    settings.ytdlp_cookies_file = "/tmp/cookies.txt"
    settings.ytdlp_cookies_from_browser = "firefox"
    settings.ytdlp_player_client = "web_safari"
    provider = YtDlpTranscriptProvider(settings)
    args = provider._base_args()
    assert "--cookies" in args and "/tmp/cookies.txt" in args
    assert "--cookies-from-browser" in args and "firefox" in args
    assert "--extractor-args" in args
    assert any("player_client=web_safari" in arg for arg in args)
    assert "--sleep-requests" in args


def test_find_subtitle_prefers_json3_and_ignores_info(tmp_path: Path) -> None:
    video_id = "dQw4w9WgXcQ"
    (tmp_path / f"{video_id}.en.vtt").write_text("WEBVTT")
    (tmp_path / f"{video_id}.en.json3").write_text("{}")
    (tmp_path / f"{video_id}.info.json").write_text("{}")
    found = YtDlpTranscriptProvider._find_subtitle(str(tmp_path), video_id)
    assert found is not None
    assert found.suffix == ".json3"


def test_describe_subtitle_manual_vs_auto(tmp_path: Path) -> None:
    video_id = "dQw4w9WgXcQ"
    path = tmp_path / f"{video_id}.en.json3"
    path.write_text("{}")
    lang, kind = YtDlpTranscriptProvider._describe_subtitle(
        path, video_id, {"subtitles": {"en": []}}
    )
    assert (lang, kind) == ("en", "manual")
    lang, kind = YtDlpTranscriptProvider._describe_subtitle(
        path, video_id, {"automatic_captions": {"en": []}}
    )
    assert (lang, kind) == ("en", "auto")


async def test_ytdlp_retries_on_429_then_succeeds(settings: Settings, monkeypatch) -> None:
    settings.ytdlp_429_max_retries = 2
    settings.ytdlp_429_backoff_seconds = 0.01
    settings.ytdlp_min_interval_seconds = 0.0
    provider = YtDlpTranscriptProvider(settings)
    calls = {"count": 0}

    async def fake_run(args, timeout):  # noqa: ANN001
        calls["count"] += 1
        if calls["count"] < 3:
            return (1, "", "ERROR: HTTP Error 429: Too Many Requests")
        return (0, "{}", "")

    monkeypatch.setattr(provider, "_run_ytdlp", fake_run)
    code, stdout, _stderr = await provider._run_ytdlp_with_retry(["yt-dlp"], 5)
    assert code == 0
    assert calls["count"] == 3


async def test_ytdlp_gives_up_after_retries(settings: Settings, monkeypatch) -> None:
    settings.ytdlp_429_max_retries = 1
    settings.ytdlp_429_backoff_seconds = 0.01
    settings.ytdlp_min_interval_seconds = 0.0
    provider = YtDlpTranscriptProvider(settings)

    async def always_429(args, timeout):  # noqa: ANN001
        return (1, "", "HTTP Error 429: Too Many Requests")

    monkeypatch.setattr(provider, "_run_ytdlp", always_429)
    code, _stdout, stderr = await provider._run_ytdlp_with_retry(["yt-dlp"], 5)
    assert code == 1
    assert isinstance(_map_ytdlp_error(stderr), YouTubeRateLimited)


async def test_fallback_provider_converts_segments(settings: Settings, monkeypatch) -> None:
    class FakeSnippet:
        def __init__(self, start: float, duration: float, text: str) -> None:
            self.start = start
            self.duration = duration
            self.text = text

    class FakeTranscript:
        def __init__(self) -> None:
            self._items = [FakeSnippet(0.0, 1.5, "Hello world"), FakeSnippet(1.5, 2.0, "Second line")]

        def __iter__(self):  # noqa: ANN204
            return iter(self._items)

    class FakeApi:
        def fetch(self, video_id, languages=()):  # noqa: ANN001
            assert video_id == "dQw4w9WgXcQ"
            return FakeTranscript()

    fake_module = types.SimpleNamespace(YouTubeTranscriptApi=FakeApi)
    monkeypatch.setitem(sys.modules, "youtube_transcript_api", fake_module)

    provider = YtDlpTranscriptProvider(settings)
    segments = await provider._fallback_segments("dQw4w9WgXcQ", ["en"])
    assert segments is not None
    assert segments[0].text == "Hello world"
    assert segments[0].start == 0.0


async def test_fallback_disabled_returns_none(settings: Settings) -> None:
    settings.transcript_fallback_enabled = False
    provider = YtDlpTranscriptProvider(settings)
    assert await provider._fallback_segments("dQw4w9WgXcQ", ["en"]) is None
