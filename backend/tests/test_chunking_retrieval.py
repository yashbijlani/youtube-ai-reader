"""Chunking and retrieval tests."""

from __future__ import annotations

from app.models.schemas import TranscriptSegment
from app.services.chunking import chunk_segments
from app.services.retrieval import ChunkIndex


def make_segments(count: int, words_per_segment: int = 12) -> list[TranscriptSegment]:
    segments = []
    for i in range(count):
        text = " ".join(f"word{i}x{j}" for j in range(words_per_segment))
        segments.append(
            TranscriptSegment(start=float(i * 5), end=float(i * 5 + 5), text=text)
        )
    return segments


def test_chunking_respects_limits_and_timestamps() -> None:
    chunks = chunk_segments(
        make_segments(40), target_chars=200, max_chars=300, max_duration_seconds=30
    )
    assert chunks
    for index, chunk in enumerate(chunks):
        assert chunk.index == index
        assert len(chunk.text) <= 300
        assert chunk.end >= chunk.start
    for prev, nxt in zip(chunks, chunks[1:], strict=False):
        assert nxt.start >= prev.start
        assert nxt.end >= nxt.start


def test_chunking_empty_input() -> None:
    assert chunk_segments([]) == []


def test_chunking_prefers_sentence_boundaries() -> None:
    segments = [
        TranscriptSegment(start=0, end=2, text="First sentence."),
        TranscriptSegment(start=2, end=4, text="Second sentence."),
        TranscriptSegment(start=4, end=6, text="Third sentence."),
    ]
    chunks = chunk_segments(segments, target_chars=20, max_chars=500)
    assert len(chunks) >= 1
    assert chunks[0].text.startswith("First sentence.")


def test_retrieval_finds_relevant_chunk() -> None:
    segments = [s.model_copy() for s in make_segments(30)]
    segments[17] = TranscriptSegment(
        start=85, end=90, text="the economics of software and AI pricing models"
    )
    chunks = chunk_segments(segments, target_chars=120, max_chars=200)
    index = ChunkIndex(chunks)
    results = index.search("AI pricing models", top_k=3)
    assert results
    assert any("pricing models" in r.chunk.text for r in results[:2])


def test_retrieval_context_respects_char_budget() -> None:
    chunks = chunk_segments(make_segments(50), target_chars=150, max_chars=250)
    index = ChunkIndex(chunks)
    context, used = index.retrieve_context("word3x4", top_k=6, max_chars=400)
    assert used
    assert sum(len(c.text) for c in used) <= 450
    assert context


def test_retrieval_falls_back_without_keywords() -> None:
    chunks = chunk_segments(make_segments(20), target_chars=200, max_chars=300)
    index = ChunkIndex(chunks)
    context, used = index.retrieve_context("what is this about?", top_k=4)
    assert used
    assert context


def test_retrieval_falls_back_near_current_time() -> None:
    chunks = chunk_segments(make_segments(20), target_chars=200, max_chars=300)
    index = ChunkIndex(chunks)
    _, used = index.retrieve_context("but and the", top_k=3, current_time=50.0)
    assert used
    assert any(abs(c.start - 50.0) <= 60 for c in used)
