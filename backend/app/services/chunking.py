"""Transcript chunking for retrieval and AI context construction."""

from __future__ import annotations

from app.models.schemas import TranscriptChunk, TranscriptSegment

_END_CHARS = (".", "!", "?", "。", "！", "？", '"')


def chunk_segments(
    segments: list[TranscriptSegment],
    target_chars: int = 1200,
    max_chars: int = 1800,
    max_duration_seconds: float = 120.0,
) -> list[TranscriptChunk]:
    """Merge transcript segments into chunks of roughly ``target_chars``.

    Chunk boundaries prefer sentence-ending segments. Every chunk keeps its
    original start/end timestamps so answers can cite real positions.
    """
    if not segments:
        return []

    chunks: list[TranscriptChunk] = []
    current: list[TranscriptSegment] = []
    current_chars = 0

    def flush() -> None:
        nonlocal current, current_chars
        if not current:
            return
        text = " ".join(s.text for s in current).strip()
        if text:
            chunks.append(
                TranscriptChunk(
                    index=len(chunks),
                    start=current[0].start,
                    end=max(current[-1].end, current[0].start),
                    text=text,
                )
            )
        current = []
        current_chars = 0

    for seg in segments:
        seg_chars = len(seg.text) + 1
        duration = seg.end - current[0].start if current else 0.0
        would_exceed = current_chars + seg_chars > max_chars
        would_exceed_target = current_chars >= target_chars and current_chars + seg_chars > target_chars
        duration_exceeded = bool(current) and duration > max_duration_seconds
        if current and (would_exceed or would_exceed_target or duration_exceeded):
            flush()
        current.append(seg)
        current_chars += seg_chars
        if seg.text.rstrip().endswith(_END_CHARS) and current_chars >= target_chars:
            flush()

    flush()
    return chunks
