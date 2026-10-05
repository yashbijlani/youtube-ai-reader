"""Shared test fixtures: fake providers, isolated settings, API client."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models.schemas import Transcript, TranscriptSegment, VideoMeta
from app.services.ai_provider import AIProvider, CompletionResult
from app.services.transcript import TranscriptProvider, TranscriptResult

TEST_VIDEO_ID = "dQw4w9WgXcQ"

SAMPLE_SEGMENTS = [
    TranscriptSegment(start=0.0, end=3.0, text="Welcome to this talk about software."),
    TranscriptSegment(start=3.0, end=8.0, text="Today we will discuss how AI changes programming."),
    TranscriptSegment(start=8.0, end=14.0, text="First, generating code becomes dramatically cheaper."),
    TranscriptSegment(start=14.0, end=20.0, text="That changes the economics of the entire industry."),
    TranscriptSegment(start=20.0, end=26.0, text="Second, programmers focus more on judgment and taste."),
    TranscriptSegment(start=26.0, end=32.0, text="Finally, we look at what the future holds for developers."),
]


def sample_transcript() -> Transcript:
    return Transcript(
        video_id=TEST_VIDEO_ID,
        language="en",
        kind="manual",
        segments=[s.model_copy() for s in SAMPLE_SEGMENTS],
    )


def sample_meta() -> VideoMeta:
    return VideoMeta(
        video_id=TEST_VIDEO_ID,
        url=f"https://www.youtube.com/watch?v={TEST_VIDEO_ID}",
        title="How AI Changes Software",
        channel="Test Channel",
        duration=32.0,
        language="en",
        subtitle_kind="manual",
    )


class FakeTranscriptProvider(TranscriptProvider):
    def __init__(
        self,
        meta: VideoMeta | None = None,
        transcript: Transcript | None = None,
        error: Exception | None = None,
    ) -> None:
        self.meta = meta or sample_meta()
        self.transcript = transcript or sample_transcript()
        self.error = error
        self.calls = 0

    async def fetch(self, video_id: str) -> TranscriptResult:
        self.calls += 1
        await asyncio.sleep(0)
        if self.error:
            raise self.error
        return TranscriptResult(meta=self.meta, transcript=self.transcript)


class ScriptedAIProvider(AIProvider):
    """Deterministic provider that answers each prompt kind with valid output."""

    def __init__(self, *, broken_json: bool = False, fail: bool = False) -> None:
        self.model = "scripted-test-model"
        self.broken_json = broken_json
        self.fail = fail
        self.calls: list[str] = []
        self.models: list[str | None] = []
        self.request_types: list[str | None] = []

    def _kind(self, messages: list[dict[str, str]]) -> str:
        system = messages[0]["content"]
        if "taking notes" in system:
            return "notes"
        if "asked for a summary" in system:
            return "summary"
        if "structured reading guide" in system:
            return "overview"
        if "meaningful chapters" in system:
            return "chapters"
        if "article-like" in system:
            return "reading"
        if "viewer questions" in system:
            return "chat"
        return "unknown"

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        json_mode: bool = False,
        max_tokens: int | None = None,
        temperature: float | None = None,
        model: str | None = None,
        request_type: object | None = None,
        on_usage: object | None = None,
    ) -> CompletionResult:
        if self.fail:
            from app.errors import AIProviderError

            raise AIProviderError("scripted failure")
        kind = self._kind(messages)
        self.calls.append(kind)
        self.models.append(model)
        self.request_types.append(getattr(request_type, "value", request_type))
        if self.broken_json and kind in ("overview", "chapters", "chat"):
            text = "I'm sorry, I cannot produce JSON right now. {broken"
        elif kind == "notes":
            text = "- [0:00] Intro to software economics\n- [0:14] Cheaper code generation"
        elif kind == "overview":
            text = json.dumps(
                {
                    "overview": "A talk about how AI changes software economics.",
                    "key_points": [
                        {
                            "title": "AI changes the economics of software",
                            "explanation": "Generating code becomes dramatically cheaper.",
                            "start_seconds": 14,
                        },
                        {
                            "title": "Judgment matters more",
                            "explanation": "Programmers focus on taste and judgment.",
                            "start_seconds": 20,
                        },
                    ],
                }
            )
        elif kind == "chapters":
            text = json.dumps(
                {
                    "chapters": [
                        {
                            "title": "Cheaper code generation",
                            "description": "AI reduces the cost of writing code.",
                            "start_seconds": 8,
                            "end_seconds": 20,
                        },
                        {
                            "title": "The future of developers",
                            "description": "Judgment and taste become central.",
                            "start_seconds": 20,
                            "end_seconds": 32,
                        },
                    ]
                }
            )
        elif kind == "reading":
            text = (
                "## Cheaper code generation\n\n"
                "The speaker argues that AI makes code generation dramatically cheaper "
                "[0:08], changing the economics of the industry [0:14]."
            )
        elif kind == "chat":
            text = json.dumps(
                {
                    "answer": "DHH-style argument: AI makes code cheap [0:08].",
                    "citations": [{"start_seconds": 8, "quote": "generating code becomes cheaper"}],
                }
            )
        else:
            text = "ok"
        return CompletionResult(
            text=text, model=self.model, input_chars=100, output_chars=len(text), latency_ms=5
        )

    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
        model: str | None = None,
        request_type: object | None = None,
        on_usage: object | None = None,
    ) -> AsyncIterator[str]:
        if self.fail:
            from app.errors import AIProviderError

            raise AIProviderError("scripted failure")
        self.calls.append("chat-stream")
        self.models.append(model)
        self.request_types.append(getattr(request_type, "value", request_type))
        for piece in ["The speaker ", "argues AI ", "makes code cheap [0:08]."]:
            yield piece


class SlowAIProvider(ScriptedAIProvider):
    """Delays guide generation so the chat-ready phase can be observed."""

    def __init__(self, delay: float = 0.6) -> None:
        super().__init__()
        self.delay = delay

    async def complete(self, messages, **kwargs):  # type: ignore[override]
        if self._kind(messages) in ("overview", "chapters", "reading"):
            await asyncio.sleep(self.delay)
        return await super().complete(messages, **kwargs)


class PreflightFailProvider(ScriptedAIProvider):
    """Fails preflight with a given terminal error."""

    def __init__(self, error: Exception) -> None:
        super().__init__()
        self._error = error

    async def preflight(self) -> None:  # type: ignore[override]
        raise self._error


@pytest.fixture()
def settings(tmp_path, monkeypatch) -> Settings:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL_MAIN", "scripted-test-model")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CACHE_ENABLED", "true")
    monkeypatch.setenv("LOG_LEVEL", "WARNING")
    return Settings(_env_file=None)


@pytest.fixture()
def fake_transcript() -> FakeTranscriptProvider:
    return FakeTranscriptProvider()


@pytest.fixture()
def fake_ai() -> ScriptedAIProvider:
    return ScriptedAIProvider()


@pytest.fixture()
def client(settings: Settings, fake_transcript: FakeTranscriptProvider, fake_ai: ScriptedAIProvider):
    from app.services.rate_limit import limiter

    limiter._events.clear()
    app = create_app(settings)
    with TestClient(app) as test_client:
        service = app.state.video_service
        service.transcript_provider = fake_transcript
        service.ai_provider = fake_ai
        service.reader.provider = fake_ai
        test_client.service = service  # type: ignore[attr-defined]
        test_client.fake_ai = fake_ai  # type: ignore[attr-defined]
        test_client.fake_transcript = fake_transcript  # type: ignore[attr-defined]
        yield test_client
