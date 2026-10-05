"""YouTube URL validation and video ID extraction tests."""

from __future__ import annotations

import pytest

from app.errors import InvalidYouTubeUrl
from app.services.youtube import canonical_watch_url, extract_video_id, is_youtube_url


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("http://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://music.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ", "dQw4w9WgXcQ"),
    ],
)
def test_extract_video_id_valid(url: str, expected: str) -> None:
    assert extract_video_id(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        "",
        "   ",
        "https://example.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/watch?v=",
        "https://www.youtube.com/watch",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQx",
        "https://www.youtube.com/watch?v=../etc/passwd",
        "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
        "dQw4w9WgXc",  # 10 chars
        "https://youtu.be/",
    ],
)
def test_extract_video_id_invalid(url: str) -> None:
    with pytest.raises(InvalidYouTubeUrl):
        extract_video_id(url)


def test_invalid_host_with_lookalike_subdomain() -> None:
    assert not is_youtube_url("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")


def test_canonical_watch_url_rejects_bad_id() -> None:
    with pytest.raises(InvalidYouTubeUrl):
        canonical_watch_url("not-an-id")


def test_canonical_watch_url() -> None:
    assert canonical_watch_url("dQw4w9WgXcQ") == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
