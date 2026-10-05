"""Subtitle parsing and normalisation.

Supports WebVTT and YouTube's json3 caption format. The goal is a clean list
of (start, end, text) segments that preserves timestamps while removing the
rolling-duplicate lines YouTube auto-captions are famous for.
"""

from __future__ import annotations

import json
import re

from app.models.schemas import TranscriptSegment
from app.utils.text import clean_text, strip_sound_tags

_VTT_TIME_RE = re.compile(
    r"(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})"
)
_JSON3_TAG_RE = re.compile(r"<[^>]+>")


def _vtt_time(hours: str | None, minutes: str, seconds: str, millis: str) -> float:
    return (
        int(hours or 0) * 3600
        + int(minutes) * 60
        + int(seconds)
        + int(millis) / (10 ** len(millis))
    )


def parse_vtt(content: str) -> list[TranscriptSegment]:
    """Parse WebVTT into raw segments (dedup happens later)."""
    segments: list[TranscriptSegment] = []
    lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        match = _VTT_TIME_RE.search(line)
        if not match:
            i += 1
            continue
        start = _vtt_time(*match.groups()[:4])
        end = _vtt_time(*match.groups()[4:])
        i += 1
        cue_lines: list[str] = []
        while i < len(lines) and lines[i].strip():
            text = clean_text(lines[i])
            if text:
                cue_lines.append(text)
            i += 1
        if not cue_lines:
            continue
        # VTT may repeat the previous line inside a cue (karaoke/rolling cues).
        unique: list[str] = []
        for cue_line in cue_lines:
            if not unique or unique[-1] != cue_line:
                unique.append(cue_line)
        text = " ".join(unique).strip()
        if text:
            segments.append(TranscriptSegment(start=start, end=max(end, start), text=text))
    return segments


def parse_json3(content: str) -> list[TranscriptSegment]:
    """Parse YouTube json3 captions into phrase-level segments.

    Manual captions arrive as one event per cue. Auto captions arrive as tiny
    events (often word or two-word fragments with ``aAppend``); those are
    grouped into short phrases so downstream chunking behaves well.
    """
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return []

    events = data.get("events") or []
    raw: list[tuple[float, float, str]] = []
    for event in events:
        segs = event.get("segs")
        if not segs:
            continue
        start_ms = event.get("tStartMs")
        dur_ms = event.get("dDurationMs")
        if start_ms is None:
            continue
        text = "".join(seg.get("utf8", "") for seg in segs)
        text = _JSON3_TAG_RE.sub("", text)
        text = clean_text(text)
        if not text:
            continue
        start = start_ms / 1000.0
        duration = (dur_ms or 0) / 1000.0
        raw.append((start, start + max(duration, 0.05), text))

    if not raw:
        return []

    # Word-level auto captions: many very short events. Group into phrases.
    short_events = sum(1 for _, _, t in raw if len(t.split()) <= 3) / len(raw)
    if len(raw) > 20 and short_events > 0.6:
        return _group_word_events(raw)

    return [TranscriptSegment(start=s, end=max(e, s), text=t) for s, e, t in raw]


def _group_word_events(raw: list[tuple[float, float, str]]) -> list[TranscriptSegment]:
    segments: list[TranscriptSegment] = []
    current_words: list[str] = []
    current_start = raw[0][0]
    current_end = raw[0][1]
    for start, end, text in raw:
        gap = start - current_end
        words_in_current = sum(len(w.split()) for w in current_words)
        if current_words and (gap > 1.2 or words_in_current >= 9 or text.endswith((".", "!", "?"))):
            segments.append(
                TranscriptSegment(
                    start=current_start,
                    end=max(current_end, current_start),
                    text=" ".join(current_words).strip(),
                )
            )
            current_words = []
            current_start = start
        current_words.append(text)
        current_end = end
    if current_words:
        segments.append(
            TranscriptSegment(
                start=current_start,
                end=max(current_end, current_start),
                text=" ".join(current_words).strip(),
            )
        )
    return segments


def _dedupe_rolling(segments: list[TranscriptSegment]) -> list[TranscriptSegment]:
    """Remove rolling caption duplication from auto-generated subtitles."""
    out: list[TranscriptSegment] = []
    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue
        if out:
            prev = out[-1].text.strip()
            if text == prev:
                out[-1].end = max(out[-1].end, seg.end)
                continue
            if text.startswith(prev) and len(text) > len(prev):
                # Rolling cue appended new words to the previous line.
                out[-1] = TranscriptSegment(
                    start=out[-1].start, end=max(out[-1].end, seg.end), text=text
                )
                continue
            if prev.startswith(text) and len(prev) >= len(text):
                out[-1].end = max(out[-1].end, seg.end)
                continue
        out.append(TranscriptSegment(start=seg.start, end=max(seg.end, seg.start), text=text))
    return out


def normalize_segments(segments: list[TranscriptSegment]) -> list[TranscriptSegment]:
    """Full normalisation pipeline: clean, dedupe, sort, fix timing, drop noise."""
    cleaned: list[TranscriptSegment] = []
    for seg in segments:
        text = strip_sound_tags(clean_text(seg.text))
        if not text:
            continue
        cleaned.append(
            TranscriptSegment(start=float(seg.start), end=float(seg.end), text=text)
        )
    cleaned.sort(key=lambda s: (s.start, s.end))
    cleaned = _dedupe_rolling(cleaned)

    out: list[TranscriptSegment] = []
    for seg in cleaned:
        if out and seg.start <= out[-1].end - 0.05 and seg.text == out[-1].text:
            out[-1].end = max(out[-1].end, seg.end)
            continue
        out.append(seg)

    # Enforce monotonic, non-zero durations.
    for idx, seg in enumerate(out):
        if seg.end <= seg.start:
            nxt = out[idx + 1].start if idx + 1 < len(out) else seg.start + 2.0
            seg.end = max(seg.start + 0.5, min(nxt, seg.start + 8.0))
    return out


_TTML_P_RE = re.compile(r"<p\b([^>]*)>(.*?)</p>", re.S | re.I)
_ATTR_RE = re.compile(r'\b([a-zA-Z:]+)="([^"]*)"')
_SRV3_TEXT_RE = re.compile(
    r'<text[^>]*\bstart="([0-9.]+)"[^>]*\bdur="([0-9.]+)"[^>]*>(.*?)</text>',
    re.S | re.I,
)


def _xml_time(value: str) -> float | None:
    match = re.match(r"^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$", value)
    if match:
        frac = f"0.{match.group(4)}" if match.group(4) else "0"
        return (
            int(match.group(1)) * 3600
            + int(match.group(2)) * 60
            + int(match.group(3))
            + float(frac)
        )
    try:
        return float(value)
    except ValueError:
        return None


def parse_ttml(content: str) -> list[TranscriptSegment]:
    """Minimal TTML / SRV3 parser used only as a last-resort fallback."""
    segments: list[TranscriptSegment] = []
    for match in _TTML_P_RE.finditer(content):
        attrs = {key.lower(): value for key, value in _ATTR_RE.findall(match.group(1))}
        begin_raw = attrs.get("begin") or attrs.get("t")
        if begin_raw is None:
            continue
        begin = _xml_time(begin_raw)
        if begin is None:
            continue
        if attrs.get("end"):
            end = _xml_time(attrs["end"]) or begin
        elif attrs.get("d"):
            try:
                end = begin + float(attrs["d"])
            except ValueError:
                end = begin
        else:
            end = begin
        text = clean_text(match.group(2))
        if text:
            segments.append(TranscriptSegment(start=begin, end=max(end, begin), text=text))
    if segments:
        return segments
    for match in _SRV3_TEXT_RE.finditer(content):
        start = float(match.group(1))
        dur = float(match.group(2))
        text = clean_text(match.group(3))
        if text:
            segments.append(TranscriptSegment(start=start, end=start + dur, text=text))
    return segments


def parse_subtitle_content(content: str, extension: str = "") -> list[TranscriptSegment]:
    ext = extension.lower().lstrip(".")
    stripped = content.lstrip("\ufeff \t\r\n")
    if ext == "json3" or stripped.startswith("{"):
        return parse_json3(content)
    if ext in ("ttml", "xml", "srv3") or stripped.startswith("<"):
        parsed = parse_ttml(content)
        if parsed:
            return parsed
    return parse_vtt(content)
