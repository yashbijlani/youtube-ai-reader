"""Video processing orchestration, caching, and chat services."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.config import Settings
from app.errors import (
    AIProviderNotConfigured,
    ProcessingInProgress,
    ServerBusy,
    TranscriptTooLarge,
    TranscriptUnavailable,
    VideoNotProcessed,
)
from app.models.schemas import (
    Analysis,
    AnalysisStatus,
    Chapter,
    ChatRequest,
    ChatResponse,
    ErrorInfo,
    IngestRequest,
    JobStatus,
    KeyPoint,
    Transcript,
    TranscriptChunk,
    TranscriptSegment,
    Usage,
    VideoMeta,
    VideoState,
)
from app.services.ai.usage import AIUsageContext, AIUsageRecorder
from app.services.ai_provider import AIProvider
from app.services.cache import FileCache
from app.services.chunking import chunk_segments
from app.services.metrics import Metrics
from app.services.metrics import metrics as global_metrics
from app.services.reader import AIReader
from app.services.retrieval import ChunkIndex
from app.services.store.base import Store
from app.services.subtitles import normalize_segments, parse_json3
from app.services.transcript import TranscriptProvider
from app.services.youtube import canonical_watch_url, extract_video_id

logger = logging.getLogger("youtube_ai_reader.video")

STAGE_MESSAGES = {
    "queued": "Queued…",
    "fetching_metadata": "Getting video information…",
    "fetching_transcript": "Finding transcript…",
    "preparing": "Reading transcript…",
    "chat_ready": "Ready to chat.",
    "summarizing": "Understanding the video…",
    "chapters": "Building chapters…",
    "writing": "Writing the detailed reading…",
    "ready": "Ready.",
}

ANALYSIS_PARTS = ("analysis_overview", "analysis_chapters", "analysis_reading")


@dataclass
class Job:
    video_id: str
    user_id: str | None = None
    status: JobStatus = "idle"
    stage: str = "queued"
    stage_message: str = "Queued…"
    error: ErrorInfo | None = None
    analysis_status: AnalysisStatus = "pending"
    analysis: Analysis | None = None
    reading_sections: dict[int, str] = field(default_factory=dict)
    quick_read: str = ""
    started_at: float = field(default_factory=time.monotonic)
    finished_at: float | None = None
    task: asyncio.Task | None = None

    @property
    def finished(self) -> bool:
        return self.status in ("ready", "error")


class VideoService:
    def __init__(
        self,
        settings: Settings,
        cache: FileCache,
        transcript_provider: TranscriptProvider,
        ai_provider: AIProvider,
        metrics: Metrics | None = None,
        usage_recorder: AIUsageRecorder | None = None,
        store: Store | None = None,
    ) -> None:
        self.settings = settings
        self.cache = cache
        self.transcript_provider = transcript_provider
        self.ai_provider = ai_provider
        self.usage_recorder = usage_recorder or AIUsageRecorder()
        self.store = store
        self.reader = AIReader(ai_provider, settings, usage_recorder=self.usage_recorder)
        self.metrics = metrics or global_metrics
        self.jobs: dict[str, Job] = {}
        self._indexes: dict[str, ChunkIndex] = {}
        self._job_semaphore = asyncio.Semaphore(max(1, settings.max_concurrent_jobs))
        self._chats_inflight = 0
        self._subscribers: dict[str, set[asyncio.Queue]] = {}

    # ------------------------------------------------------------ events

    def _emit(self, video_id: str, event: dict[str, Any]) -> None:
        for queue in list(self._subscribers.get(video_id, ())):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.debug("[events] subscriber queue full video=%s", video_id)

    def _subscribe(self, video_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self._subscribers.setdefault(video_id, set()).add(queue)
        return queue

    def _unsubscribe(self, video_id: str, queue: asyncio.Queue) -> None:
        subscribers = self._subscribers.get(video_id)
        if subscribers is None:
            return
        subscribers.discard(queue)
        if not subscribers:
            self._subscribers.pop(video_id, None)

    # ------------------------------------------------------------- state

    def _job_for(self, video_id: str) -> Job | None:
        return self.jobs.get(video_id)

    def get_state(self, video_id: str) -> VideoState:
        job = self._job_for(video_id)
        if job and job.status != "idle":
            return self._state_from_job(job)
        cached = self._load_cached_state(video_id)
        if cached:
            return cached
        return VideoState(video_id=video_id, status="idle")

    def _state_from_job(self, job: Job) -> VideoState:
        meta = self._load_meta(job.video_id)
        transcript = self.cache.read_json(job.video_id, "transcript")
        analysis = job.analysis if job.analysis is not None else self._load_analysis(job.video_id)
        return VideoState(
            video_id=job.video_id,
            status=job.status,
            stage=job.stage,
            stage_message=job.stage_message,
            error=job.error,
            metadata=meta,
            transcript_available=transcript is not None,
            analysis_status=job.analysis_status,
            analysis=analysis,
            cached=False,
        )

    def _load_cached_state(self, video_id: str) -> VideoState | None:
        if not self._cache_current(video_id):
            return None
        meta = self._load_meta(video_id)
        transcript_raw = self.cache.read_json(video_id, "transcript")
        analysis = self._load_analysis(video_id)
        if not meta or transcript_raw is None or analysis is None:
            return None
        stored = self.cache.read_json(video_id, "analysis") or {}
        return VideoState(
            video_id=video_id,
            status="ready",
            stage="ready",
            stage_message=STAGE_MESSAGES["ready"],
            metadata=meta,
            transcript_available=True,
            analysis_status="ready",
            analysis=analysis,
            cached=True,
            processed_at=stored.get("processed_at"),
        )

    def _load_meta(self, video_id: str) -> VideoMeta | None:
        raw = self.cache.read_json(video_id, "metadata")
        if not raw:
            return None
        try:
            return VideoMeta.model_validate(raw)
        except Exception:  # noqa: BLE001 - stale cache should not break the app
            return None

    def _load_analysis(self, video_id: str) -> Analysis | None:
        overview = self.cache.read_json(video_id, "analysis_overview")
        chapters = self.cache.read_json(video_id, "analysis_chapters")
        reading = self.cache.read_json(video_id, "analysis_reading")
        if overview is not None or chapters is not None or reading is not None:
            return self._compose_analysis(overview, chapters, reading)
        raw = self.cache.read_json(video_id, "analysis")
        if not raw:
            return None
        try:
            return Analysis.model_validate(raw.get("analysis", raw))
        except Exception:  # noqa: BLE001
            return None

    @staticmethod
    def _compose_analysis(
        overview: dict | None, chapters: dict | None, reading: dict | None
    ) -> Analysis:
        parts = [part for part in (overview, chapters, reading) if part]
        degraded = any(bool(part.get("degraded")) for part in parts)
        reason = next(
            (part.get("degraded_reason") for part in parts if part.get("degraded_reason")),
            None,
        )
        model = next((part.get("model") for part in parts if part.get("model")), None)
        version = next(
            (
                part.get("prompt_version")
                for part in parts
                if part.get("prompt_version") is not None
            ),
            None,
        )
        return Analysis(
            overview=(overview or {}).get("overview", "") or "",
            key_points=_key_points_of(overview),
            chapters=_chapters_of(chapters),
            detailed_reading=(reading or {}).get("detailed_reading", "") or "",
            generated_by=model,
            prompt_version=version,
            degraded=degraded,
            degraded_reason=reason,
        )

    def _write_part(self, video_id: str, name: str, data: dict[str, Any]) -> None:
        self.cache.write_json(video_id, name, {**data, "generated_at": datetime.now(timezone.utc).isoformat()})

    def load_transcript(self, video_id: str) -> Transcript:
        raw = self.cache.read_json(video_id, "transcript")
        if raw is None:
            raise VideoNotProcessed(video_id)
        return Transcript.model_validate(raw)

    def load_chunks(self, video_id: str) -> list[TranscriptChunk]:
        raw = self.cache.read_json(video_id, "chunks")
        if raw is None:
            transcript = self.load_transcript(video_id)
            chunks = chunk_segments(
                transcript.segments,
                target_chars=self.settings.chunk_target_chars,
                max_chars=self.settings.chunk_max_chars,
                max_duration_seconds=self.settings.chunk_max_duration_seconds,
            )
            self.cache.write_json(video_id, "chunks", [c.model_dump() for c in chunks])
            return chunks
        return [TranscriptChunk.model_validate(item) for item in raw]

    def get_index(self, video_id: str) -> ChunkIndex:
        index = self._indexes.get(video_id)
        if index is None:
            index = ChunkIndex(self.load_chunks(video_id))
            self._indexes[video_id] = index
        return index

    # ----------------------------------------------------------- process

    async def process(
        self, youtube_url: str, *, force: bool = False, user_id: str | None = None
    ) -> VideoState:
        video_id = extract_video_id(youtube_url)
        job = self.jobs.get(video_id)
        if job and job.status == "processing":
            if user_id and not job.user_id:
                job.user_id = user_id
            return self._state_from_job(job)
        if job and job.status == "ready" and job.analysis_status in ("pending", "partial"):
            # Analysis is still streaming in the background; keep the client attached.
            return self._state_from_job(job)

        if not force:
            cached = self._load_cached_state(video_id)
            if not cached and await self._hydrate_from_store(video_id):
                cached = self._load_cached_state(video_id)
            if cached:
                logger.info("[cache] hit video=%s", video_id)
                self.metrics.record_video(cached=True)
                self.jobs[video_id] = Job(
                    video_id=video_id,
                    user_id=user_id,
                    status="ready",
                    stage="ready",
                    stage_message=STAGE_MESSAGES["ready"],
                    analysis_status="ready",
                )
                return cached

        if not self.settings.ai_configured:
            raise AIProviderNotConfigured()

        # Fail fast (402/403/404) before spending a YouTube fetch.
        await self.ai_provider.preflight()

        resume = (not force) and self._has_transcript_cache(video_id)
        initial_stage = "chat_ready" if resume else "queued"
        job = Job(
            video_id=video_id,
            user_id=user_id,
            status="ready" if resume else "processing",
            stage=initial_stage,
            stage_message=STAGE_MESSAGES[initial_stage],
            analysis_status="pending",
        )
        self.jobs[video_id] = job
        logger.info("[video] processing requested id=%s force=%s resume=%s", video_id, force, resume)
        job.task = asyncio.create_task(self._run_job(job, force=force))
        return self._state_from_job(job)

    def _cache_current(self, video_id: str) -> bool:
        """A cached entry is reusable when it is the current cache version.

        The title is intentionally *not* required: a transcript ingested from the
        client may legitimately carry a placeholder title, and discarding it would
        force an unnecessary server yt-dlp fallback (which fails on datacenter
        hosts). Old/wrong entries are still invalidated by the cache version.
        """
        raw = self.cache.read_json(video_id, "metadata")
        return isinstance(raw, dict) and raw.get("cache_version") == self.settings.cache_version

    def _meta_dict(self, meta: VideoMeta) -> dict[str, Any]:
        return {**meta.model_dump(), "cache_version": self.settings.cache_version}

    def _has_transcript_cache(self, video_id: str) -> bool:
        if not self._cache_current(video_id):
            return False
        return self.cache.read_json(video_id, "transcript") is not None and bool(
            self.cache.read_json(video_id, "chunks")
        )

    # --------------------------------------------------------- persistence

    async def _persist_video(
        self,
        video_id: str,
        *,
        status: str | None = None,
        metadata: dict[str, Any] | None = None,
        transcript: dict[str, Any] | None = None,
        chunks: list[dict[str, Any]] | None = None,
        analysis: dict[str, Any] | None = None,
    ) -> None:
        """Write the canonical video bundle to the authoritative store."""
        if self.store is None:
            return
        if metadata is not None:
            metadata = {**metadata, "cache_version": self.settings.cache_version}
        try:
            await self.store.save_video(
                video_id,
                status=status,
                metadata=metadata,
                transcript=transcript,
                chunks=chunks,
                analysis=analysis,
            )
        except Exception:  # noqa: BLE001 - persistence must not break processing
            logger.warning("[store] failed to persist video=%s", video_id, exc_info=True)

    async def _hydrate_from_store(self, video_id: str) -> bool:
        """Populate the local cache from the canonical store on a cache miss."""
        if self.store is None:
            return False
        try:
            bundle = await self.store.load_video(video_id)
        except Exception:  # noqa: BLE001
            logger.warning("[store] failed to load video=%s", video_id, exc_info=True)
            return False
        if not bundle:
            return False
        bundle_meta = bundle.get("metadata") or {}
        if bundle_meta.get("cache_version") != self.settings.cache_version:
            return False
        if bundle.get("metadata"):
            self.cache.write_json(video_id, "metadata", bundle["metadata"])
        if bundle.get("transcript"):
            self.cache.write_json(video_id, "transcript", bundle["transcript"])
        if bundle.get("chunks"):
            self.cache.write_json(video_id, "chunks", bundle["chunks"])
        if bundle.get("transcript_source"):
            self.cache.write_json(video_id, "transcript_source", bundle["transcript_source"])
        if bundle.get("analysis"):
            self.cache.write_json(
                video_id,
                "analysis",
                {"analysis": bundle["analysis"], "generated_at": datetime.now(timezone.utc).isoformat()},
            )
        if bundle.get("analysis_quick_read"):
            self.cache.write_json(video_id, "analysis_quick_read", bundle["analysis_quick_read"])
        return bool(bundle.get("metadata") and bundle.get("transcript"))

    async def _ensure_transcript(
        self, video_id: str, force: bool, stage: Any
    ) -> tuple[VideoMeta, Transcript, list[TranscriptChunk], bool]:
        """Load a cached transcript or fetch a fresh one with yt-dlp."""
        if not force and self._has_transcript_cache(video_id):
            meta = self._load_meta(video_id)
            raw = self.cache.read_json(video_id, "transcript")
            if meta and raw:
                try:
                    transcript = Transcript.model_validate(raw)
                    chunks = self.load_chunks(video_id)
                    if chunks:
                        logger.info("[cache] reusing transcript video=%s", video_id)
                        return meta, transcript, chunks, False
                except Exception:  # noqa: BLE001 - fall through to a fresh fetch
                    logger.warning("[cache] unusable transcript video=%s", video_id)

        stage("fetching_metadata")
        result = await self.transcript_provider.fetch(video_id)
        meta, transcript = result.meta, result.transcript
        if transcript.char_count > self.settings.max_transcript_chars:
            raise TranscriptTooLarge()
        self.cache.write_json(video_id, "metadata", self._meta_dict(meta))
        self.cache.write_json(video_id, "transcript", transcript.model_dump())

        stage("preparing")
        chunks = chunk_segments(
            transcript.segments,
            target_chars=self.settings.chunk_target_chars,
            max_chars=self.settings.chunk_max_chars,
            max_duration_seconds=self.settings.chunk_max_duration_seconds,
        )
        if not chunks:
            raise TranscriptUnavailable()
        self.cache.write_json(video_id, "chunks", [c.model_dump() for c in chunks])
        return meta, transcript, chunks, True

    async def _run_job(self, job: Job, *, force: bool) -> None:
        video_id = job.video_id
        started = time.monotonic()
        metrics_before = self.metrics.snapshot()

        def stage(name: str, message: str | None = None) -> None:
            job.stage = name
            job.stage_message = message or STAGE_MESSAGES.get(name, name)

        parts: dict[str, Any] = {"overview": None, "chapters": None, "reading": ""}

        def compose() -> Analysis:
            overview_text, key_points = parts["overview"] or ("", [])
            chapters = parts["chapters"] or []
            reading = parts["reading"] or ""
            return Analysis(
                overview=overview_text,
                key_points=key_points,
                chapters=chapters,
                detailed_reading=reading,
                generated_by=self.reader.fast_model or self.settings.opencode_model,
                prompt_version=self.settings.prompt_version,
                degraded=not (overview_text or chapters or reading),
                degraded_reason=None,
            )

        def on_overview(text: str, points: list[KeyPoint]) -> None:
            parts["overview"] = (text, points)
            self._write_part(
                video_id,
                "analysis_overview",
                {
                    "overview": text,
                    "key_points": [p.model_dump() for p in points],
                    "model": self.reader.fast_model or self.settings.opencode_model,
                    "prompt_version": self.settings.prompt_version,
                    "degraded": not text,
                    "degraded_reason": None if text else "The overview could not be generated.",
                },
            )
            job.analysis = compose()
            job.analysis_status = "partial"
            self._emit(
                video_id,
                {
                    "type": "part",
                    "part": "overview",
                    "overview": text,
                    "key_points": [p.model_dump() for p in points],
                },
            )

        def on_chapters(chapters: list[Chapter]) -> None:
            parts["chapters"] = chapters
            self._write_part(
                video_id,
                "analysis_chapters",
                {
                    "chapters": [c.model_dump() for c in chapters],
                    "model": self.reader.fast_model or self.settings.opencode_model,
                    "prompt_version": self.settings.prompt_version,
                    "degraded": not chapters,
                    "degraded_reason": None if chapters else "Chapters could not be generated.",
                },
            )
            job.analysis = compose()
            job.analysis_status = "partial"
            self._emit(
                video_id,
                {
                    "type": "part",
                    "part": "chapters",
                    "chapters": [c.model_dump() for c in chapters],
                },
            )

        def on_reading_delta(index: int, piece: str) -> None:
            job.reading_sections[index] = job.reading_sections.get(index, "") + piece
            self._emit(
                video_id, {"type": "reading_delta", "index": index, "text": piece}
            )

        def on_reading_section(index: int, text: str) -> None:
            job.reading_sections[index] = text
            self._emit(
                video_id, {"type": "reading_section", "index": index, "text": text}
            )

        def on_reading(text: str, complete: bool) -> None:
            parts["reading"] = text
            self._write_part(
                video_id,
                "analysis_reading",
                {
                    "detailed_reading": text,
                    "model": self.settings.opencode_model,
                    "prompt_version": self.settings.prompt_version,
                    "degraded": not text,
                    "degraded_reason": (
                        None if text else "The detailed reading could not be generated."
                    ),
                    "complete": complete,
                },
            )
            job.analysis = compose()
            if text:
                job.analysis_status = "partial"

        def on_quick_read_delta(piece: str) -> None:
            job.quick_read += piece
            self._emit(video_id, {"type": "quick_read_delta", "text": piece})

        def on_quick_read(text: str) -> None:
            job.quick_read = text
            self._write_part(
                video_id,
                "analysis_quick_read",
                {
                    "quick_read": text,
                    "model": self.reader.fast_model or self.settings.opencode_model,
                    "prompt_version": self.settings.prompt_version,
                },
            )
            self._emit(video_id, {"type": "quick_read", "text": text})

        try:
            acquired = False
            try:
                await asyncio.wait_for(
                    self._job_semaphore.acquire(), timeout=self.settings.job_queue_timeout_seconds
                )
                acquired = True
            except asyncio.TimeoutError:
                raise ServerBusy() from None

            try:
                if force:
                    self._indexes.pop(video_id, None)
                    for name in ("analysis", *ANALYSIS_PARTS):
                        self.cache.delete(video_id, name)

                meta, transcript, chunks, fetched = await self._ensure_transcript(
                    video_id, force, stage
                )
                self._indexes[video_id] = ChunkIndex(chunks)

                # Phase 1 complete: chat, transcript and chapters are usable now.
                job.status = "ready"
                job.error = None
                job.stage = "chat_ready"
                job.stage_message = STAGE_MESSAGES["chat_ready"]
                job.analysis_status = "pending"
                self.metrics.record_video(cached=False)
                await self._persist_video(
                    video_id,
                    status="transcript_ready",
                    metadata=self._meta_dict(meta),
                    transcript={**transcript.model_dump(), "source": "server_ytdlp"},
                    chunks=[chunk.model_dump() for chunk in chunks],
                )
                logger.info(
                    "[video] chat ready id=%s transcript=%dc chunks=%d fetched=%s fetch_time=%.1fs",
                    video_id,
                    transcript.char_count,
                    len(chunks),
                    fetched,
                    time.monotonic() - started,
                )

                # Phase 2: build the guide in the background, persisting parts as they land.
                analysis = await self.reader.analyze(
                    meta,
                    chunks,
                    transcript.char_count,
                    usage_context=AIUsageContext(user_id=job.user_id, video_id=video_id),
                    on_stage=stage,
                    on_overview=on_overview,
                    on_chapters=on_chapters,
                    on_reading=on_reading,
                    on_reading_delta=on_reading_delta,
                    on_reading_section=on_reading_section,
                    on_quick_read_delta=on_quick_read_delta,
                    on_quick_read=on_quick_read,
                )
                job.analysis = analysis
                job.analysis_status = (
                    "ready"
                    if (analysis.overview or analysis.chapters or analysis.detailed_reading)
                    else "error"
                )
                processed_at = datetime.now(timezone.utc).isoformat()
                self.cache.write_json(
                    video_id,
                    "analysis",
                    {
                        "analysis": analysis.model_dump(),
                        "model": analysis.generated_by,
                        "prompt_version": analysis.prompt_version,
                        "processed_at": processed_at,
                    },
                )
                job.stage = "ready"
                job.stage_message = STAGE_MESSAGES["ready"]
                job.finished_at = time.monotonic()
                await self._persist_video(video_id, analysis=analysis.model_dump())
                self._emit(video_id, {"type": "done", "analysis_status": job.analysis_status})
                logger.info(
                    "[video] guide ready id=%s degraded=%s duration=%.1fs",
                    video_id,
                    analysis.degraded,
                    time.monotonic() - started,
                )
                if analysis.degraded:
                    logger.warning(
                        "[video] degraded analysis id=%s reason=%s",
                        video_id,
                        analysis.degraded_reason,
                    )
            finally:
                if acquired:
                    self._job_semaphore.release()
                self._log_cost(video_id, started, metrics_before)
        except Exception as exc:  # noqa: BLE001 - every failure becomes a friendly state
            from app.errors import AppError

            if isinstance(exc, AppError):
                code, message = exc.code, exc.message
            else:
                logger.exception("[video] unexpected failure id=%s", video_id)
                code, message = "internal_error", "Something went wrong while processing this video."
            if job.status == "ready":
                # Transcript already works; keep chat available and flag the guide.
                job.analysis_status = "error"
                job.analysis = job.analysis or compose()
                job.stage = "ready"
                job.stage_message = "The reading guide could not be generated."
                job.finished_at = time.monotonic()
                logger.warning("[video] analysis failed id=%s code=%s", video_id, code)
            else:
                job.status = "error"
                job.error = ErrorInfo(code=code, message=message)
                job.stage = "error"
                job.stage_message = message
                job.finished_at = time.monotonic()
                logger.warning("[video] failed id=%s code=%s message=%s", video_id, code, message)
            self._emit(
                video_id,
                {"type": "error", "code": code, "message": message,
                 "analysis_status": job.analysis_status},
            )

    def _log_cost(self, video_id: str, started: float, before: dict[str, Any]) -> None:
        after = self.metrics.snapshot()
        logger.info(
            "[cost] video=%s model=%s ai_calls=%d in=%dc out=%dc wall=%.1fs",
            video_id,
            self.settings.opencode_model,
            after["ai_calls"] - before["ai_calls"],
            after["ai_input_chars"] - before["ai_input_chars"],
            after["ai_output_chars"] - before["ai_output_chars"],
            time.monotonic() - started,
        )

    async def reprocess(self, video_id: str, user_id: str | None = None) -> VideoState:
        if not self.settings.ai_configured:
            raise AIProviderNotConfigured()
        job = self.jobs.get(video_id)
        if job and job.status == "processing":
            raise ProcessingInProgress()
        self.cache.delete(video_id, "analysis")
        self._indexes.pop(video_id, None)
        return await self.process(canonical_watch_url(video_id), force=True, user_id=user_id)

    def cancel(self, video_id: str) -> bool:
        job = self.jobs.get(video_id)
        if not job or not job.task or job.task.done():
            return False
        job.task.cancel()
        self.jobs.pop(video_id, None)
        logger.info("[video] cancelled id=%s", video_id)
        return True

    async def repair(self, video_id: str, user_id: str | None = None) -> VideoState:
        """Regenerate the guide for an existing transcript (keeps the captions)."""
        if not self.settings.ai_configured:
            raise AIProviderNotConfigured()
        job = self.jobs.get(video_id)
        if job and job.status == "processing":
            raise ProcessingInProgress()
        if not self._has_transcript_cache(video_id):
            raise VideoNotProcessed(video_id)
        await self.ai_provider.preflight()
        for name in ("analysis", *ANALYSIS_PARTS, "analysis_quick_read"):
            self.cache.delete(video_id, name)
        self._indexes.pop(video_id, None)
        job = Job(
            video_id=video_id,
            user_id=user_id,
            status="ready",
            stage="chat_ready",
            stage_message=STAGE_MESSAGES["chat_ready"],
            analysis_status="pending",
        )
        self.jobs[video_id] = job
        logger.info("[video] repair requested id=%s", video_id)
        job.task = asyncio.create_task(self._run_job(job, force=False))
        return self._state_from_job(job)

    # -------------------------------------------------------------- ingest

    async def ingest(
        self, video_id: str, request: IngestRequest, user_id: str | None = None
    ) -> VideoState:
        """Accept a transcript captured by the client (the user's own session)."""
        if not self.settings.ai_configured:
            raise AIProviderNotConfigured()
        job = self.jobs.get(video_id)
        if job and job.status == "processing":
            raise ProcessingInProgress()

        segments = self._parse_ingest(request)
        if not segments:
            raise TranscriptUnavailable()
        char_count = sum(len(segment.text) for segment in segments)
        if char_count > self.settings.max_transcript_chars:
            raise TranscriptTooLarge()

        title = (request.title or "").strip()
        channel = request.channel
        if not title or title == "Untitled video":
            # Best-effort public title so a client ingest never persists a
            # placeholder (oEmbed is not subject to the yt-dlp bot check).
            oembed = await self.transcript_provider.fetch_oembed_metadata(video_id)
            if oembed is not None:
                title = title or (oembed.title or "").strip()
                channel = channel or oembed.channel
        meta = VideoMeta(
            video_id=video_id,
            url=canonical_watch_url(video_id),
            title=(title or "Untitled video")[:500],
            channel=channel,
            duration=request.duration,
            language=request.language,
            subtitle_kind=request.kind,
        )
        transcript = Transcript(
            video_id=video_id,
            language=request.language,
            kind=request.kind,
            segments=segments,
        )
        chunks = chunk_segments(
            transcript.segments,
            target_chars=self.settings.chunk_target_chars,
            max_chars=self.settings.chunk_max_chars,
            max_duration_seconds=self.settings.chunk_max_duration_seconds,
        )
        if not chunks:
            raise TranscriptUnavailable()

        self.cache.write_json(video_id, "metadata", self._meta_dict(meta))
        self.cache.write_json(video_id, "transcript", transcript.model_dump())
        self.cache.write_json(video_id, "chunks", [chunk.model_dump() for chunk in chunks])
        source = request.method if request.method in ("browser_intercept", "caption_dom") else "client"
        self.cache.write_json(
            video_id,
            "transcript_source",
            {"source": source, "verified": False},
        )
        await self._persist_video(
            video_id,
            status="transcript_ready",
            metadata=self._meta_dict(meta),
            transcript={**transcript.model_dump(), "source": source},
            chunks=[chunk.model_dump() for chunk in chunks],
        )
        logger.info(
            "[ingest] client transcript id=%s source=%s segments=%d chars=%d lang=%s",
            video_id,
            source,
            len(segments),
            char_count,
            request.language,
        )

        await self.ai_provider.preflight()
        job = Job(
            video_id=video_id,
            user_id=user_id,
            status="ready",
            stage="chat_ready",
            stage_message=STAGE_MESSAGES["chat_ready"],
            analysis_status="pending",
        )
        self.jobs[video_id] = job
        job.task = asyncio.create_task(self._run_job(job, force=False))
        return self._state_from_job(job)

    def _parse_ingest(self, request: IngestRequest) -> list[TranscriptSegment]:
        if request.format == "json3" and request.content:
            return normalize_segments(parse_json3(request.content))
        if request.segments:
            cleaned = [
                TranscriptSegment(start=segment.start, end=segment.end, text=segment.text[:2000])
                for segment in request.segments
                if segment.text and segment.text.strip()
            ]
            return normalize_segments(cleaned)
        return []

    # --------------------------------------------------------------- chat

    def _require_ready(self, video_id: str) -> tuple[VideoMeta, Analysis | None]:
        state = self.get_state(video_id)
        if state.status == "processing":
            raise ProcessingInProgress()
        if state.status != "ready" or not state.metadata:
            raise VideoNotProcessed(video_id)
        return state.metadata, state.analysis

    async def chat(
        self, video_id: str, request: ChatRequest, user_id: str | None = None
    ) -> ChatResponse:
        meta, analysis = self._require_ready(video_id)
        index = self.get_index(video_id)
        self._chats_inflight += 1
        try:
            history = [turn.model_dump() for turn in request.history]
            logger.info("[chat] retrieving transcript context id=%s", video_id)
            answer, citations, result = await self.reader.answer_question(
                meta,
                index,
                analysis,
                request.message,
                history=history,
                current_time=request.current_time_seconds,
                usage_context=AIUsageContext(user_id=user_id, video_id=video_id),
            )
            self.metrics.record_chat(
                input_chars=result.input_chars, output_chars=len(answer)
            )
            logger.info(
                "[chat] answer generated id=%s citations=%d latency=%dms",
                video_id,
                len(citations),
                result.latency_ms,
            )
            return ChatResponse(
                answer=answer,
                citations=citations,
                usage=Usage(
                    model=result.model,
                    input_chars=result.input_chars,
                    output_chars=result.output_chars,
                    latency_ms=result.latency_ms,
                ),
            )
        finally:
            self._chats_inflight -= 1

    async def stream_chat(
        self, video_id: str, request: ChatRequest, user_id: str | None = None
    ) -> AsyncIterator[dict[str, Any]]:
        meta, analysis = self._require_ready(video_id)
        index = self.get_index(video_id)
        history = [turn.model_dump() for turn in request.history]
        logger.info("[chat] streaming answer id=%s", video_id)
        async for event in self.reader.stream_answer(
            meta,
            index,
            analysis,
            request.message,
            history=history,
            current_time=request.current_time_seconds,
            usage_context=AIUsageContext(user_id=user_id, video_id=video_id),
        ):
            yield event

    async def stream_summary(
        self, video_id: str, user_id: str | None = None
    ) -> AsyncIterator[dict[str, Any]]:
        """Stream a grounded summary as soon as the transcript is ready."""
        meta, _analysis = self._require_ready(video_id)
        index = self.get_index(video_id)
        logger.info("[chat] streaming summary id=%s", video_id)
        async for event in self.reader.stream_summary(
            meta, index, usage_context=AIUsageContext(user_id=user_id, video_id=video_id)
        ):
            yield event

    async def stream_analysis(self, video_id: str) -> AsyncIterator[dict[str, Any]]:
        """Stream the guide: parts as events, reading token-by-token."""
        state = self.get_state(video_id)
        if state.status == "processing":
            raise ProcessingInProgress()
        if state.status != "ready":
            raise VideoNotProcessed(video_id)

        job = self.jobs.get(video_id)
        analysis = state.analysis
        quick_read = job.quick_read if job else ""
        if not quick_read:
            raw_quick = self.cache.read_json(video_id, "analysis_quick_read") or {}
            quick_read = raw_quick.get("quick_read", "")
        if quick_read:
            yield {"type": "quick_read", "text": quick_read}
        if analysis:
            if analysis.overview or analysis.key_points:
                yield {
                    "type": "part",
                    "part": "overview",
                    "overview": analysis.overview,
                    "key_points": [point.model_dump() for point in analysis.key_points],
                }
            if analysis.chapters:
                yield {
                    "type": "part",
                    "part": "chapters",
                    "chapters": [chapter.model_dump() for chapter in analysis.chapters],
                }
        if job and job.reading_sections:
            for index in sorted(job.reading_sections):
                yield {
                    "type": "reading_section",
                    "index": index,
                    "text": job.reading_sections[index],
                }
        elif analysis and analysis.detailed_reading:
            yield {"type": "reading", "text": analysis.detailed_reading}

        if not job or job.analysis_status in ("ready", "error"):
            yield {"type": "done", "analysis_status": job.analysis_status if job else "ready"}
            return

        queue = self._subscribe(video_id)
        logger.info("[events] analysis stream subscribed id=%s", video_id)
        try:
            while True:
                current = self.jobs.get(video_id)
                if not current or current.analysis_status in ("ready", "error"):
                    # The job finished between the snapshot and subscribing.
                    yield {
                        "type": "done",
                        "analysis_status": current.analysis_status if current else "ready",
                    }
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield {"type": "ping"}
                    continue
                yield event
                if event.get("type") in ("done", "error"):
                    break
        finally:
            self._unsubscribe(video_id, queue)

    async def aclose(self) -> None:
        tasks = [job.task for job in self.jobs.values() if job.task and not job.task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        await self.usage_recorder.aclose()
        await self.ai_provider.aclose()


def _key_points_of(overview: dict | None) -> list[KeyPoint]:
    points: list[KeyPoint] = []
    for item in (overview or {}).get("key_points") or []:
        try:
            points.append(KeyPoint.model_validate(item))
        except Exception:  # noqa: BLE001 - ignore corrupt cached entries
            continue
    return points


def _chapters_of(chapters: dict | None) -> list[Chapter]:
    parsed: list[Chapter] = []
    for item in (chapters or {}).get("chapters") or []:
        try:
            parsed.append(Chapter.model_validate(item))
        except Exception:  # noqa: BLE001
            continue
    return parsed
