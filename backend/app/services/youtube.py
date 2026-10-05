"""YouTube URL validation and video ID extraction.

User input is treated as untrusted: we only ever hand a canonical URL built from
a validated 11-character video id to yt-dlp.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

from app.errors import InvalidYouTubeUrl

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

_ALLOWED_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
    "youtu.be",
    "www.youtu.be",
}


def extract_video_id(url: str) -> str:
    """Extract a validated video id from common YouTube URL shapes.

    Supports: /watch?v=ID, youtu.be/ID, /embed/ID, /shorts/ID, /live/ID,
    /v/ID, and bare 11-character ids.
    """
    if not url or not isinstance(url, str):
        raise InvalidYouTubeUrl()
    raw = url.strip()
    if not raw:
        raise InvalidYouTubeUrl()

    if VIDEO_ID_RE.match(raw):
        return raw

    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw

    try:
        parsed = urlparse(raw)
    except ValueError as exc:  # pragma: no cover - urlparse rarely raises
        raise InvalidYouTubeUrl() from exc

    host = (parsed.hostname or "").lower()
    if host not in _ALLOWED_HOSTS:
        raise InvalidYouTubeUrl("Only YouTube URLs are supported.")

    if host.endswith("youtu.be"):
        candidate = parsed.path.lstrip("/").split("/")[0]
        return _validate_id(candidate)

    query = parse_qs(parsed.query)
    if "v" in query and query["v"]:
        return _validate_id(query["v"][0])

    match = re.match(r"^/(?:embed|shorts|live|v)/([A-Za-z0-9_-]{11})", parsed.path)
    if match:
        return _validate_id(match.group(1))

    raise InvalidYouTubeUrl("Could not find a video ID in that YouTube URL.")


def _validate_id(candidate: str) -> str:
    candidate = (candidate or "").strip()
    if not VIDEO_ID_RE.match(candidate):
        raise InvalidYouTubeUrl("Could not find a valid YouTube video ID.")
    return candidate


def canonical_watch_url(video_id: str) -> str:
    if not VIDEO_ID_RE.match(video_id):
        raise InvalidYouTubeUrl("Could not find a valid YouTube video ID.")
    return f"https://www.youtube.com/watch?v={video_id}"


def is_youtube_url(url: str) -> bool:
    try:
        extract_video_id(url)
        return True
    except InvalidYouTubeUrl:
        return False
