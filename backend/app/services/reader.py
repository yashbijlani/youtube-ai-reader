"""The AI reading pipeline: overview, chapters, detailed reading, grounded Q&A.

This layer owns prompt construction, structured-output validation, graceful
degradation, and long-video map-reduce. It only knows ``AIProvider``, so models
and providers remain swappable.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Callable
from typing import Any

from pydantic import BaseModel

from app.config import Settings
from app.errors import AIOutputError, AIProviderError
from app.models.schemas import (
    Analysis,
    Chapter,
    ChatCitation,
    KeyPoint,
    TranscriptChunk,
    Usage,
    VideoMeta,
)
from app.services import prompts
from app.services.ai import AIProvider, AIRequestType, CompletionResult, extract_json
from app.services.ai.usage import AIUsageContext, AIUsageRecorder
from app.services.retrieval import ChunkIndex
from app.utils.text import truncate
from app.utils.timestamps import format_timestamp, parse_timestamp

logger = logging.getLogger("youtube_ai_reader.reader")

StageCallback = Callable[[str, str], None]


class OverviewPayload(BaseModel):
    overview: str = ""
    key_points: list[dict[str, Any]] = []


class _CoercedOverview(BaseModel):
    overview: str
    key_points: list[KeyPoint]


def _coerce_seconds(value: Any, duration: float | None) -> float | None:
    """Best-effort coercion of model-provided timestamps into seconds."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        result = float(value)
        return result if result >= 0 else None
    if isinstance(value, str):
        parsed = parse_timestamp(value)
        if parsed is None:
            import re

            match = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", value)
            if match:
                if match.group(3):
                    parsed = (
                        int(match.group(1)) * 3600
                        + int(match.group(2)) * 60
                        + int(match.group(3))
                    )
                else:
                    parsed = int(match.group(1)) * 60 + int(match.group(2))
        if parsed is None:
            return None
        return parsed
    return None


def _clamp_start(seconds: float | None, duration: float | None) -> float | None:
    if seconds is None:
        return None
    if seconds < 0:
        return None
    if duration and seconds > duration + 30:
        return None
    return round(float(seconds), 2)


def coerce_key_points(raw: Any, duration: float | None, limit: int = 12) -> list[KeyPoint]:
    points: list[KeyPoint] = []
    if not isinstance(raw, list):
        return points
    for item in raw:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("heading") or "").strip()
        explanation = str(
            item.get("explanation") or item.get("description") or item.get("text") or ""
        ).strip()
        if not title or not explanation:
            continue
        start = _clamp_start(
            _coerce_seconds(item.get("start_seconds", item.get("timestamp")), duration),
            duration,
        )
        points.append(
            KeyPoint(
                title=title[:160],
                explanation=explanation[:1200],
                start_seconds=start,
            )
        )
        if len(points) >= limit:
            break
    return points


def coerce_chapters(raw: Any, duration: float | None, limit: int = 20) -> list[Chapter]:
    chapters: list[Chapter] = []
    if not isinstance(raw, list):
        return chapters
    for item in raw:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        start = _clamp_start(
            _coerce_seconds(item.get("start_seconds", item.get("start")), duration), duration
        )
        if start is None:
            continue
        end = _clamp_start(
            _coerce_seconds(item.get("end_seconds", item.get("end")), duration), duration
        )
        description = str(item.get("description") or "").strip() or None
        chapters.append(
            Chapter(
                title=title[:160],
                description=description[:600] if description else None,
                start_seconds=start,
                end_seconds=end,
            )
        )
    chapters.sort(key=lambda c: c.start_seconds)
    deduped: list[Chapter] = []
    for chapter in chapters:
        if deduped and chapter.start_seconds - deduped[-1].start_seconds < 5:
            continue
        deduped.append(chapter)
        if len(deduped) >= limit:
            break
    for idx, chapter in enumerate(deduped):
        next_start = deduped[idx + 1].start_seconds if idx + 1 < len(deduped) else None
        if chapter.end_seconds is None or (
            next_start is not None and chapter.end_seconds > next_start
        ):
            chapter.end_seconds = next_start
        if chapter.end_seconds is not None and chapter.end_seconds < chapter.start_seconds:
            chapter.end_seconds = chapter.start_seconds
    return deduped


def label_chunks(chunks: list[TranscriptChunk]) -> str:
    return "\n\n".join(f"[{format_timestamp(c.start)}] {c.text}" for c in chunks)


def compact_context(
    chunks: list[TranscriptChunk], max_chars: int, *, blank_line: bool = True
) -> str:
    """A whole-timeline digest that fits the budget.

    Short transcripts are sent whole. For long ones, every chunk contributes a
    leading snippet with its timestamp so the model still sees the full arc of
    the video without a costly map-reduce notes pass.
    """
    full = label_chunks(chunks)
    if len(full) <= max_chars:
        return full
    if not chunks:
        return ""
    separator = "\n\n" if blank_line else "\n"
    per_chunk = max(80, max_chars // len(chunks) - 14)
    lines = [
        f"[{format_timestamp(chunk.start)}] {truncate(chunk.text, per_chunk)}"
        for chunk in chunks
    ]
    digest = separator.join(lines)
    while len(digest) > max_chars and per_chunk > 40:
        per_chunk = int(per_chunk * 0.75)
        lines = [
            f"[{format_timestamp(chunk.start)}] {truncate(chunk.text, per_chunk)}"
            for chunk in chunks
        ]
        digest = separator.join(lines)
    return truncate(digest, max_chars)


class AIReader:
    """High-level reading tasks composed from an ``AIProvider``."""

    def __init__(
        self,
        provider: AIProvider,
        settings: Settings,
        usage_recorder: AIUsageRecorder | None = None,
    ) -> None:
        self.provider = provider
        self.settings = settings
        self.usage_recorder = usage_recorder
        self.fast_model: str | None = settings.gemini_model_fast or None

    # ------------------------------------------------------------ helpers

    def _usage_callback(self, context: AIUsageContext | None):
        if self.usage_recorder is None or context is None:
            return None

        def callback(event) -> None:  # noqa: ANN001
            self.usage_recorder.record(
                event, user_id=context.user_id, video_id=context.video_id
            )

        return callback

    async def _complete_json(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int | None = None,
        request_type: AIRequestType = AIRequestType.CHAT_COMPLEX,
        context: AIUsageContext | None = None,
    ) -> tuple[dict[str, Any], CompletionResult]:
        attempt_messages = list(messages)
        last_error: Exception | None = None
        for attempt in range(2):
            result = await self.provider.complete(
                attempt_messages,
                json_mode=True,
                max_tokens=max_tokens,
                request_type=request_type,
                on_usage=self._usage_callback(context),
            )
            try:
                return extract_json(result.text), result
            except ValueError as exc:
                last_error = exc
                logger.warning("[ai] malformed JSON on attempt %d", attempt + 1)
                attempt_messages = list(messages) + [
                    {"role": "assistant", "content": truncate(result.text, 2000)},
                    {
                        "role": "user",
                        "content": (
                            "That response was not valid JSON. Reply with the same content "
                            "as a single valid JSON object, no markdown fences, no prose."
                        ),
                    },
                ]
        raise AIOutputError(
            "The AI returned content that could not be parsed. Please try reprocessing."
        ) from last_error

    # ------------------------------------------------------- high-level API

    async def generate_summary(
        self,
        meta: VideoMeta,
        context: str,
        *,
        duration: float | None = None,
        request_type: AIRequestType = AIRequestType.ANALYSIS,
        usage_context: AIUsageContext | None = None,
    ) -> tuple[str, list[KeyPoint], CompletionResult]:
        payload, result = await self._complete_json(
            prompts.overview_prompt(meta, context),
            max_tokens=6000,
            request_type=request_type,
            context=usage_context,
        )
        overview = str(payload.get("overview") or "").strip()
        overview = overview.strip()
        points = coerce_key_points(
            payload.get("key_points") or payload.get("keyPoints") or [],
            duration if duration is not None else meta.duration,
        )
        if not overview:
            raise AIOutputError("The AI did not return an overview.")
        return overview, points, result

    async def generate_chapters(
        self,
        meta: VideoMeta,
        context: str,
        *,
        duration: float | None = None,
        request_type: AIRequestType = AIRequestType.ANALYSIS,
        usage_context: AIUsageContext | None = None,
    ) -> tuple[list[Chapter], CompletionResult]:
        payload, result = await self._complete_json(
            prompts.chapters_prompt(meta, context, duration),
            max_tokens=5000,
            request_type=request_type,
            context=usage_context,
        )
        chapters = coerce_chapters(
            payload.get("chapters") or payload.get("sections") or [],
            duration if duration is not None else meta.duration,
        )
        return chapters, result

    async def generate_reading(
        self,
        meta: VideoMeta,
        context: str,
        *,
        section_label: str | None = None,
        target_words: int = 900,
        outline: str | None = None,
        usage_context: AIUsageContext | None = None,
    ) -> tuple[str, CompletionResult]:
        result = await self.provider.complete(
            prompts.reading_prompt(meta, context, section_label, target_words, outline),
            max_tokens=6000,
            request_type=AIRequestType.GUIDE,
            on_usage=self._usage_callback(usage_context),
        )
        text = result.text.strip()
        if not text:
            raise AIOutputError("The AI returned an empty reading section.")
        return text, result

    # --------------------------------------------------------- orchestrate

    async def analyze(
        self,
        meta: VideoMeta,
        chunks: list[TranscriptChunk],
        total_chars: int,
        usage_context: AIUsageContext | None = None,
        on_stage: StageCallback | None = None,
        on_overview: Callable[[str, list[KeyPoint]], None] | None = None,
        on_chapters: Callable[[list[Chapter]], None] | None = None,
        on_reading: Callable[[str, bool], None] | None = None,
        on_reading_delta: Callable[[int, str], None] | None = None,
        on_reading_section: Callable[[int, str], None] | None = None,
        on_quick_read_delta: Callable[[str], None] | None = None,
        on_quick_read: Callable[[str], None] | None = None,
    ) -> Analysis:
        """Produce the reading guide.

        Order: a streamed quick-read first (so the UI has prose in seconds),
        then the structured overview, then chapters + detailed reading
        concurrently. Every part is retried on transient errors; terminal
        errors (funding/auth/model) are surfaced instead of retried.
        """

        def stage(name: str, message: str) -> None:
            if on_stage:
                on_stage(name, message)

        duration = meta.duration
        context = compact_context(chunks, self.settings.overview_context_chars)
        reasons: list[str] = []
        terminal: AIProviderError | None = None
        overview_text = ""
        key_points: list[KeyPoint] = []
        chapters: list[Chapter] = []
        reading = ""
        quick_read = ""

        async def attempt(label: str, fn: Callable[[], Any], attempts: int = 2) -> Any:
            nonlocal terminal
            last: Exception | None = None
            for index in range(attempts):
                try:
                    return await fn()
                except AIProviderError as exc:
                    last = exc
                    if exc.terminal:
                        terminal = exc
                        break
                    logger.warning("[ai] %s attempt %d failed: %s", label, index + 1, exc)
                    await asyncio.sleep(0.4 * (index + 1))
                except AIOutputError as exc:
                    last = exc
                    logger.warning("[ai] %s attempt %d bad output: %s", label, index + 1, exc)
                    await asyncio.sleep(0.4 * (index + 1))
            raise last if last else AIOutputError(f"{label} failed")

        # --- streamed quick-read -------------------------------------------------
        stage("quick_read", "Reading the video…")

        async def quick_read_call() -> str:
            buffer: list[str] = []
            async for piece in self.provider.stream(
                prompts.summary_prompt(meta, context),
                max_tokens=900,
                request_type=AIRequestType.SUMMARY,
                on_usage=self._usage_callback(usage_context),
            ):
                buffer.append(piece)
                if on_quick_read_delta:
                    on_quick_read_delta(piece)
            return "".join(buffer).strip()

        try:
            quick_read = await attempt("quick_read", quick_read_call, attempts=2)
        except (AIProviderError, AIOutputError) as exc:
            logger.warning("[ai] quick read failed: %s", exc)
        if on_quick_read:
            on_quick_read(quick_read)

        outline: str | None = quick_read or _extractive_outline(chunks)

        # --- structured overview -------------------------------------------------
        stage("summarizing", "Understanding the video…")
        try:
            overview_text, key_points, _ = await attempt(
                "overview",
                lambda: self.generate_summary(
                    meta, context, duration=duration, usage_context=usage_context
                ),
            )
        except (AIProviderError, AIOutputError) as exc:
            logger.warning("[ai] overview failed: %s", exc)
            reasons.append("overview")
        if on_overview:
            on_overview(overview_text, key_points)
        if overview_text:
            titles = "; ".join(point.title for point in key_points[:8])
            outline = truncate(
                f"{overview_text}\nKey ideas: {titles}" if titles else overview_text, 1200
            )

        async def chapters_job() -> None:
            nonlocal chapters
            if meta.creator_chapters and len(meta.creator_chapters) >= 3:
                chapters = list(meta.creator_chapters)
                logger.info("[ai] using %d creator chapters", len(chapters))
                if on_chapters:
                    on_chapters(chapters)
                return
            stage("chapters", "Building chapters…")
            try:
                chapters, _ = await attempt(
                    "chapters",
                    lambda: self.generate_chapters(
                        meta, context, duration=duration, usage_context=usage_context
                    ),
                )
            except (AIProviderError, AIOutputError) as exc:
                logger.warning("[ai] chapters failed: %s", exc)
                reasons.append("chapters")
            if on_chapters:
                on_chapters(chapters)

        async def reading_job() -> None:
            nonlocal reading
            stage("writing", "Writing the detailed reading…")
            try:
                reading = await self.generate_reading_sections(
                    meta,
                    chunks,
                    total_chars,
                    on_reading=on_reading,
                    on_reading_delta=on_reading_delta,
                    on_reading_section=on_reading_section,
                    outline=outline,
                    usage_context=usage_context,
                )
            except (AIOutputError, AIProviderError) as exc:
                logger.warning("[ai] reading failed: %s", exc)
                reasons.append("reading")
            if on_reading:
                on_reading(reading, True)

        await asyncio.gather(chapters_job(), reading_job())

        degraded = bool(reasons)
        degraded_reason = None
        if degraded:
            names = ", ".join(dict.fromkeys(reasons))
            if terminal is not None:
                degraded_reason = f"{terminal.message} (failed: {names})"
            else:
                degraded_reason = f"Could not generate: {names}"
        return Analysis(
            overview=overview_text,
            key_points=key_points,
            chapters=chapters,
            detailed_reading=reading,
            generated_by=self.provider.model,
            prompt_version=self.settings.prompt_version,
            degraded=degraded,
            degraded_reason=degraded_reason,
        )

    async def generate_reading_sections(
        self,
        meta: VideoMeta,
        chunks: list[TranscriptChunk],
        total_chars: int,
        *,
        on_reading: Callable[[str, bool], None] | None = None,
        on_reading_delta: Callable[[int, str], None] | None = None,
        on_reading_section: Callable[[int, str], None] | None = None,
        outline: str | None = None,
        usage_context: AIUsageContext | None = None,
    ) -> str:
        """Write the detailed reading section by section, concurrently, streaming.

        Each section retries once, then falls back to a non-streaming completion
        so a transient stream failure still produces text.
        """
        raw_limit = self.settings.reading_section_chars * self.settings.max_reading_sections
        sections = _plan_batches(
            chunks,
            batch_chars=self.settings.reading_section_chars,
            max_batches=self.settings.max_reading_sections,
        )
        if total_chars <= raw_limit:
            sources = [label_chunks(section) for section in sections]
        else:
            # Very long transcript: compress each section to its budget instead of
            # running an expensive map-reduce pass.
            sources = [
                compact_context(section, self.settings.reading_section_chars, blank_line=False)
                for section in sections
            ]
        if not sources:
            raise AIOutputError("The detailed reading could not be generated.")

        results: dict[int, str] = {}
        terminal_error: AIProviderError | None = None
        semaphore = asyncio.Semaphore(max(1, self.settings.analysis_reading_concurrency))

        def emit_joined(complete: bool) -> None:
            if on_reading:
                on_reading(self._join_sections(results), complete)

        async def run(index: int, source: str) -> None:
            nonlocal terminal_error
            async with semaphore:
                target = max(300, min(1200, len(source) // 14))
                messages = prompts.reading_prompt(
                    meta,
                    source,
                    section_label=f"part {index + 1} of {len(sources)}",
                    target_words=target,
                    outline=outline,
                )
                buffer: list[str] = []
                text = ""
                try:
                    async for piece in self.provider.stream(
                        messages,
                        max_tokens=6000,
                        request_type=AIRequestType.GUIDE,
                        on_usage=self._usage_callback(usage_context),
                    ):
                        buffer.append(piece)
                        if on_reading_delta:
                            on_reading_delta(index, piece)
                    text = "".join(buffer).strip()
                except AIProviderError as exc:
                    if exc.terminal:
                        terminal_error = exc
                        logger.warning("[ai] reading section %d terminal: %s", index + 1, exc)
                        emit_joined(False)
                        return
                    logger.warning(
                        "[ai] reading section %d stream failed (%s); retrying non-streamed",
                        index + 1,
                        exc,
                    )
                except AIOutputError as exc:
                    logger.warning("[ai] reading section %d empty stream: %s", index + 1, exc)

                if not text:
                    try:
                        text, _ = await self.generate_reading(
                            meta,
                            source,
                            section_label=f"part {index + 1} of {len(sources)}",
                            target_words=target,
                            outline=outline,
                            usage_context=usage_context,
                        )
                    except (AIProviderError, AIOutputError) as exc:
                        logger.warning("[ai] reading section %d failed: %s", index + 1, exc)
                        emit_joined(False)
                        return

                results[index] = text
                if on_reading_section:
                    on_reading_section(index, text)
                emit_joined(len(results) >= len(sources))

        logger.info(
            "[ai] writing reading sections=%d concurrency=%d",
            len(sources),
            self.settings.analysis_reading_concurrency,
        )
        await asyncio.gather(*(run(index, source) for index, source in enumerate(sources)))
        if not results:
            if terminal_error is not None:
                raise terminal_error
            raise AIOutputError("The detailed reading could not be generated.")
        return self._join_sections(results)

    @staticmethod
    def _join_sections(results: dict[int, str]) -> str:
        return "\n\n".join(results[index] for index in sorted(results))

    # ---------------------------------------------------------------- chat

    async def answer_question(
        self,
        meta: VideoMeta,
        index: ChunkIndex,
        analysis: Analysis | None,
        question: str,
        *,
        history: list[dict[str, str]] | None = None,
        current_time: float | None = None,
        top_k: int | None = None,
        usage_context: AIUsageContext | None = None,
    ) -> tuple[str, list[ChatCitation], CompletionResult]:
        messages, used_chunks = self._chat_messages(
            meta,
            index,
            analysis,
            question,
            history=history,
            current_time=current_time,
            top_k=top_k,
            streaming=False,
        )
        try:
            payload, result = await self._complete_json(
                messages,
                max_tokens=4000,
                request_type=AIRequestType.CHAT_COMPLEX,
                context=usage_context,
            )
            answer = str(payload.get("answer") or payload.get("response") or "").strip()
            citations = _coerce_citations(
                payload.get("citations"), used_chunks, index, meta.duration
            )
            if not answer:
                raise AIOutputError()
        except (AIOutputError, ValueError):
            logger.warning("[chat] structured answer failed; using plain completion")
            plain = await self.provider.complete(
                messages,
                max_tokens=4000,
                request_type=AIRequestType.CHAT_COMPLEX,
                on_usage=self._usage_callback(usage_context),
            )
            answer = plain.text.strip()
            citations = _fallback_citations(used_chunks)
            result = plain
        if not citations:
            citations = _fallback_citations(used_chunks)
        return answer, citations, result

    async def stream_answer(
        self,
        meta: VideoMeta,
        index: ChunkIndex,
        analysis: Analysis | None,
        question: str,
        *,
        history: list[dict[str, str]] | None = None,
        current_time: float | None = None,
        top_k: int | None = None,
        usage_context: AIUsageContext | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        messages, used_chunks = self._chat_messages(
            meta,
            index,
            analysis,
            question,
            history=history,
            current_time=current_time,
            top_k=top_k,
            streaming=True,
        )
        started = time.monotonic()
        input_chars = sum(len(m.get("content", "")) for m in messages)
        output_chars = 0
        async for piece in self.provider.stream(
            messages,
            max_tokens=4000,
            request_type=AIRequestType.CHAT_COMPLEX,
            on_usage=self._usage_callback(usage_context),
        ):
            output_chars += len(piece)
            yield {"type": "delta", "text": piece}
        yield {
            "type": "done",
            "citations": [c.model_dump() for c in _fallback_citations(used_chunks)],
            "usage": Usage(
                model=self.provider.model,
                input_chars=input_chars,
                output_chars=output_chars,
                latency_ms=int((time.monotonic() - started) * 1000),
            ).model_dump(),
        }

    async def stream_summary(
        self,
        meta: VideoMeta,
        index: ChunkIndex,
        usage_context: AIUsageContext | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Stream a grounded summary immediately, without waiting for the guide."""
        context, used_chunks = index.retrieve_context(
            "Summarize this video",
            top_k=self.settings.chat_top_k,
            max_chars=self.settings.chat_context_chars,
        )
        messages = prompts.summary_prompt(meta, context)
        started = time.monotonic()
        input_chars = sum(len(m.get("content", "")) for m in messages)
        output_chars = 0
        async for piece in self.provider.stream(
            messages,
            max_tokens=2500,
            request_type=AIRequestType.SUMMARY,
            on_usage=self._usage_callback(usage_context),
        ):
            output_chars += len(piece)
            yield {"type": "delta", "text": piece}
        yield {
            "type": "done",
            "citations": [c.model_dump() for c in _fallback_citations(used_chunks)],
            "usage": Usage(
                model=self.settings.effective_fast_model,
                input_chars=input_chars,
                output_chars=output_chars,
                latency_ms=int((time.monotonic() - started) * 1000),
            ).model_dump(),
        }

    def _chat_messages(
        self,
        meta: VideoMeta,
        index: ChunkIndex,
        analysis: Analysis | None,
        question: str,
        *,
        history: list[dict[str, str]] | None,
        current_time: float | None,
        top_k: int | None,
        streaming: bool,
    ) -> tuple[list[dict[str, str]], list[TranscriptChunk]]:
        context, used_chunks = index.retrieve_context(
            question,
            top_k=top_k or self.settings.chat_top_k,
            max_chars=self.settings.chat_context_chars,
            current_time=current_time,
        )
        summary_context = "Not available."
        if analysis:
            points = "; ".join(
                f"{p.title}" + (f" [{format_timestamp(p.start_seconds)}]" if p.start_seconds else "")
                for p in analysis.key_points[:8]
            )
            summary_context = truncate(
                f"{analysis.overview}\nKey ideas: {points}" if points else analysis.overview, 1800
            )
        messages = prompts.chat_prompt(meta, summary_context, context, current_time, streaming)
        for turn in (history or [])[-self.settings.chat_history_turns :]:
            role = turn.get("role")
            content = turn.get("content") or ""
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": truncate(content, 2000)})
        messages.append({"role": "user", "content": question})
        return messages, used_chunks


# ------------------------------------------------------------------ helpers


def _extractive_outline(
    chunks: list[TranscriptChunk], max_items: int = 8
) -> str | None:
    """Cheap whole-video outline from evenly spaced chunk snippets."""
    if not chunks:
        return None
    step = max(1, len(chunks) // max_items)
    picks = chunks[::step][:max_items]
    return "\n".join(f"[{format_timestamp(c.start)}] {truncate(c.text, 160)}" for c in picks)


def _plan_batches(
    chunks: list[TranscriptChunk], *, batch_chars: int, max_batches: int
) -> list[list[TranscriptChunk]]:
    if not chunks:
        return []
    total = sum(len(c.text) + 1 for c in chunks)
    count = max(1, min(max_batches, -(-total // max(1, batch_chars))))
    if count == 1:
        return [list(chunks)]
    target = total / count
    batches: list[list[TranscriptChunk]] = []
    current: list[TranscriptChunk] = []
    current_chars = 0
    remaining_chunks = len(chunks)
    for chunk in chunks:
        current.append(chunk)
        current_chars += len(chunk.text) + 1
        remaining_chunks -= 1
        remaining_batches = count - len(batches) - 1
        if remaining_batches > 0 and current_chars >= target and remaining_chunks >= remaining_batches:
            batches.append(current)
            current = []
            current_chars = 0
    if current:
        batches.append(current)
    return batches


def _coerce_citations(
    raw: Any,
    used_chunks: list[TranscriptChunk],
    index: ChunkIndex,
    duration: float | None,
) -> list[ChatCitation]:
    citations: list[ChatCitation] = []
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            seconds = _coerce_seconds(
                item.get("start_seconds", item.get("timestamp", item.get("start"))), duration
            )
            if seconds is None:
                continue
            seconds = _clamp_start(seconds, duration)
            if seconds is None:
                continue
            quote = str(item.get("quote") or item.get("text") or "").strip() or None
            citations.append(
                ChatCitation(
                    start_seconds=seconds,
                    end_seconds=None,
                    quote=truncate(quote, 240) if quote else None,
                )
            )
    unique: list[ChatCitation] = []
    seen: set[int] = set()
    for citation in citations:
        key = int(citation.start_seconds)
        if key in seen:
            continue
        seen.add(key)
        unique.append(citation)
    if not unique:
        return _fallback_citations(used_chunks)
    unique.sort(key=lambda c: c.start_seconds)
    return unique[:4]


def _fallback_citations(used_chunks: list[TranscriptChunk], limit: int = 3) -> list[ChatCitation]:
    citations: list[ChatCitation] = []
    seen: set[int] = set()
    for chunk in used_chunks:
        key = int(chunk.start)
        if key in seen:
            continue
        seen.add(key)
        citations.append(
            ChatCitation(
                start_seconds=chunk.start,
                end_seconds=chunk.end,
                quote=truncate(chunk.text, 200),
            )
        )
        if len(citations) >= limit:
            break
    return citations
