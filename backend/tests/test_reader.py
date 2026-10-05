"""AI output parsing and graceful-degradation tests."""

from __future__ import annotations

import pytest

from app.config import Settings
from app.errors import AIOutputError
from app.services.ai_provider import extract_json
from app.services.chunking import chunk_segments
from app.services.reader import (
    AIReader,
    _coerce_seconds,
    coerce_chapters,
    coerce_key_points,
)
from app.services.retrieval import ChunkIndex
from app.utils.text import tokenize
from tests.conftest import ScriptedAIProvider, sample_meta, sample_transcript

# ------------------------------------------------------------- extract_json


def test_extract_json_plain() -> None:
    assert extract_json('{"a": 1}') == {"a": 1}


def test_extract_json_fenced() -> None:
    text = 'Sure! Here you go:\n```json\n{"a": [1, 2]}\n```'
    assert extract_json(text) == {"a": [1, 2]}


def test_extract_json_preamble_and_trailing_text() -> None:
    text = 'Result: {"a": "b"} hope that helps'
    assert extract_json(text) == {"a": "b"}


def test_extract_json_repairs_trailing_comma() -> None:
    assert extract_json('{"a": 1, "b": [1, 2,],}') == {"a": 1, "b": [1, 2]}


def test_extract_json_raises_on_garbage() -> None:
    with pytest.raises(ValueError):
        extract_json("not json at all")


# ------------------------------------------------------------ coercion


def test_coerce_seconds_variants() -> None:
    assert _coerce_seconds(12, 100) == 12.0
    assert _coerce_seconds("17:32", 2000) == 1052.0
    assert _coerce_seconds("[1:02:05]", 5000) == 3725.0
    assert _coerce_seconds("garbage", 100) is None
    assert _coerce_seconds(-5, 100) is None


def test_coerce_key_points_filters_and_clamps() -> None:
    raw = [
        {"title": "Good", "explanation": "Yes.", "start_seconds": "17:32"},
        {"title": "", "explanation": "No title."},
        {"title": "No explanation", "explanation": ""},
        {"title": "Out of range", "explanation": "Beyond video.", "start_seconds": 9999},
        "not a dict",
    ]
    points = coerce_key_points(raw, duration=3600)
    assert len(points) == 2
    assert points[0].start_seconds == 1052.0
    assert points[1].start_seconds is None


def test_coerce_chapters_sorts_and_fills_ends() -> None:
    raw = [
        {"title": "Later", "start_seconds": 60, "end_seconds": 120},
        {"title": "First", "start_seconds": 0, "end_seconds": 90},
        {"title": "No start", "description": "x"},
    ]
    chapters = coerce_chapters(raw, duration=180)
    assert [c.title for c in chapters] == ["First", "Later"]
    assert chapters[0].end_seconds == 60
    assert chapters[1].end_seconds == 120


# ------------------------------------------------------------- AIReader


async def test_analyze_short_video_direct_path(settings: Settings) -> None:
    provider = ScriptedAIProvider()
    reader = AIReader(provider, settings)
    transcript = sample_transcript()
    chunks = chunk_segments(transcript.segments)
    analysis = await reader.analyze(sample_meta(), chunks, transcript.char_count)
    assert "AI" in analysis.overview or analysis.overview
    assert analysis.key_points
    assert analysis.chapters
    assert analysis.detailed_reading
    assert "notes" not in provider.calls


async def test_analyze_long_video_uses_compact_digest(settings: Settings) -> None:
    settings.overview_context_chars = 200
    provider = ScriptedAIProvider()
    reader = AIReader(provider, settings)
    transcript = sample_transcript()
    chunks = chunk_segments(transcript.segments, target_chars=80, max_chars=120)
    analysis = await reader.analyze(sample_meta(), chunks, transcript.char_count)
    assert "notes" not in provider.calls
    assert "overview" in provider.calls
    assert "chat-stream" in provider.calls
    assert analysis.overview
    assert analysis.detailed_reading


async def test_analyze_surfaces_partial_parts(settings: Settings) -> None:
    provider = ScriptedAIProvider()
    reader = AIReader(provider, settings)
    transcript = sample_transcript()
    chunks = chunk_segments(transcript.segments)
    seen: dict[str, object] = {}
    await reader.analyze(
        sample_meta(),
        chunks,
        transcript.char_count,
        on_overview=lambda text, points: seen.__setitem__("overview", text),
        on_chapters=lambda chapters: seen.__setitem__("chapters", len(chapters)),
        on_reading=lambda text, complete: seen.__setitem__("reading_done", complete),
    )
    assert seen.get("overview")
    assert seen.get("chapters", 0) == 2
    assert seen.get("reading_done") is True


async def test_chat_falls_back_when_json_is_malformed(settings: Settings) -> None:
    provider = ScriptedAIProvider(broken_json=True)
    reader = AIReader(provider, settings)
    transcript = sample_transcript()
    chunks = chunk_segments(transcript.segments)
    index = ChunkIndex(chunks)
    answer, citations, _ = await reader.answer_question(
        sample_meta(), index, None, "How does AI change software?"
    )
    assert answer
    assert citations
    assert all(c.start_seconds >= 0 for c in citations)


async def test_chat_returns_structured_citations(settings: Settings) -> None:
    provider = ScriptedAIProvider()
    reader = AIReader(provider, settings)
    transcript = sample_transcript()
    chunks = chunk_segments(transcript.segments)
    index = ChunkIndex(chunks)
    answer, citations, _ = await reader.answer_question(
        sample_meta(), index, None, "What changes about programming?"
    )
    assert answer
    assert citations
    assert citations[0].start_seconds == 8.0


async def test_generate_summary_raises_on_empty_overview(settings: Settings) -> None:
    class EmptyProvider(ScriptedAIProvider):
        async def complete(self, messages, **kwargs):  # type: ignore[override]
            from app.services.ai_provider import CompletionResult

            return CompletionResult(text='{"overview": "", "key_points": []}', model="x")

    reader = AIReader(EmptyProvider(), settings)
    with pytest.raises(AIOutputError):
        await reader.generate_summary(sample_meta(), "context")


def test_tokenize_removes_stopwords() -> None:
    tokens = tokenize("The economics of software and the future of AI")
    assert "the" not in tokens
    assert "economics" in tokens
    assert "ai" in tokens
