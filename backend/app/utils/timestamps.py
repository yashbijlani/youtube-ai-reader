"""Timestamp parsing and formatting helpers."""

from __future__ import annotations

import re

_TS_RE = re.compile(r"^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$")


def format_timestamp(seconds: float | int | None, force_hours: bool = False) -> str:
    """Format seconds as ``M:SS`` or ``H:MM:SS`` (hours added when needed)."""
    if seconds is None:
        return ""
    total = max(0, int(seconds))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    if hours or force_hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def parse_timestamp(value: str) -> float | None:
    """Parse ``mm:ss``, ``hh:mm:ss`` or ``ss`` into seconds. Returns None if invalid."""
    if value is None:
        return None
    text = str(value).strip().strip("[]")
    if not text:
        return None
    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        return float(text)
    match = _TS_RE.match(text)
    if not match:
        return None
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2))
    secs = int(match.group(3))
    millis = match.group(4) or "0"
    fraction = int(millis) / (10 ** len(millis))
    return hours * 3600 + minutes * 60 + secs + fraction


def seconds_to_clock(seconds: float, with_hours: bool | None = None) -> str:
    """Human clock used inside prompt context, e.g. ``17:32`` or ``1:02:11``."""
    if with_hours is None:
        with_hours = seconds >= 3600
    return format_timestamp(seconds, force_hours=with_hours)
