"""Pydantic schemas shared by the API and services."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.utils.timestamps import format_timestamp

JobStatus = Literal["idle", "processing", "ready", "error"]
AnalysisStatus = Literal["pending", "partial", "ready", "error"]
SubtitleKind = Literal["manual", "auto", "none"]


# ---------------------------------------------------------------- transcript


class TranscriptSegment(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str

    @field_validator("end")
    @classmethod
    def end_after_start(cls, v: float, info) -> float:  # noqa: ANN001
        start = info.data.get("start")
        if start is not None and v < start:
            return start
        return v


class Transcript(BaseModel):
    video_id: str
    language: str | None = None
    language_name: str | None = None
    kind: SubtitleKind = "none"
    segments: list[TranscriptSegment] = Field(default_factory=list)

    @property
    def full_text(self) -> str:
        return " ".join(s.text for s in self.segments)

    @property
    def char_count(self) -> int:
        return sum(len(s.text) for s in self.segments)


class TranscriptChunk(BaseModel):
    index: int
    start: float
    end: float
    text: str

    @property
    def approx_tokens(self) -> int:
        return max(1, len(self.text) // 4)


# ------------------------------------------------------------------- video


class VideoMeta(BaseModel):
    video_id: str
    url: str
    title: str
    channel: str | None = None
    duration: float | None = None
    thumbnail: str | None = None
    language: str | None = None
    subtitle_kind: SubtitleKind | None = None
    creator_chapters: list["Chapter"] | None = None


class KeyPoint(BaseModel):
    title: str
    explanation: str
    start_seconds: float | None = None

    @property
    def timestamp(self) -> str | None:
        return format_timestamp(self.start_seconds) if self.start_seconds is not None else None


class Chapter(BaseModel):
    title: str
    description: str | None = None
    start_seconds: float = Field(ge=0)
    end_seconds: float | None = None


class Analysis(BaseModel):
    overview: str
    key_points: list[KeyPoint] = Field(default_factory=list)
    chapters: list[Chapter] = Field(default_factory=list)
    detailed_reading: str = ""
    generated_by: str | None = None
    prompt_version: int | None = None
    degraded: bool = False
    degraded_reason: str | None = None


# ------------------------------------------------------------------- state


class ErrorInfo(BaseModel):
    code: str
    message: str


class VideoState(BaseModel):
    video_id: str
    status: JobStatus = "idle"
    stage: str | None = None
    stage_message: str | None = None
    error: ErrorInfo | None = None
    metadata: VideoMeta | None = None
    transcript_available: bool | None = None
    analysis_status: AnalysisStatus = "pending"
    analysis: Analysis | None = None
    cached: bool = False
    processed_at: str | None = None


class ProcessRequest(BaseModel):
    youtube_url: str = Field(min_length=5, max_length=2048)
    force: bool = False


class EntitlementRequest(BaseModel):
    """Best-effort paid status reported by the extension (ExtensionPay)."""

    paid: bool
    email: str | None = Field(default=None, max_length=200)


class IngestRequest(BaseModel):
    """Transcript + metadata supplied by the client (the user's own session)."""

    title: str | None = Field(default=None, max_length=500)
    channel: str | None = Field(default=None, max_length=300)
    duration: float | None = Field(default=None, ge=0, le=100_000)
    language: str | None = Field(default=None, max_length=20)
    kind: SubtitleKind = "auto"
    format: Literal["json3", "segments"] = "json3"
    content: str | None = Field(default=None, max_length=5_000_000)
    segments: list[TranscriptSegment] | None = Field(default=None, max_length=20_000)


# -------------------------------------------------------------------- chat


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20_000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2_000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=24)
    current_time_seconds: float | None = Field(default=None, ge=0)
    stream: bool = False


class ChatCitation(BaseModel):
    start_seconds: float = Field(ge=0)
    end_seconds: float | None = None
    quote: str | None = None

    @property
    def timestamp(self) -> str:
        return format_timestamp(self.start_seconds)


class Usage(BaseModel):
    model: str | None = None
    input_chars: int = 0
    output_chars: int = 0
    latency_ms: int = 0


class ChatResponse(BaseModel):
    answer: str
    citations: list[ChatCitation] = Field(default_factory=list)
    usage: Usage = Field(default_factory=Usage)


# ------------------------------------------------------------------ misc


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    ai_configured: bool
    model: str
    fast_model: str


class StatsResponse(BaseModel):
    videos_processed: int = 0
    cache_hits: int = 0
    ai_calls: int = 0
    ai_errors: int = 0
    ai_input_chars: int = 0
    ai_output_chars: int = 0
    ai_input_tokens: int = 0
    ai_output_tokens: int = 0
    ai_cost_usd: float = 0.0
    chat_requests: int = 0
    chat_input_chars: int = 0
    chat_output_chars: int = 0
    by_model: dict[str, int] = Field(default_factory=dict)


VideoMeta.model_rebuild()
