"""AI usage accounting.

Every meaningful model call is recorded with its authoritative token usage and
estimated cost. Records are logged immediately and forwarded to an optional
persistence sink (Supabase ``ai_usage`` in production).

The recorder is deliberately small: providers emit :class:`UsageEvent`, callers
attach the user/video context, and this class persists the combined record.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.services.ai.base import UsageEvent
from app.services.metrics import metrics

logger = logging.getLogger("youtube_ai_reader.ai.usage")

UsageSink = Callable[["AIUsageRecord"], Awaitable[None]]


@dataclass
class AIUsageContext:
    """Who/what a model call is attributed to."""

    user_id: str | None = None
    video_id: str | None = None


@dataclass
class AIUsageRecord:
    model: str
    request_type: str | None = None
    user_id: str | None = None
    video_id: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    estimated_cost_usd: float = 0.0
    latency_ms: int = 0
    success: bool = True
    request_id: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_row(self) -> dict[str, Any]:
        return asdict(self)


class AIUsageRecorder:
    """Builds usage records and forwards them to a persistence sink."""

    def __init__(self, sink: UsageSink | None = None) -> None:
        self.sink = sink
        self._pending: list[asyncio.Task] = []

    def record(
        self,
        event: UsageEvent,
        *,
        user_id: str | None = None,
        video_id: str | None = None,
    ) -> AIUsageRecord:
        record = AIUsageRecord(
            model=event.model,
            request_type=event.request_type,
            user_id=user_id,
            video_id=video_id,
            input_tokens=event.prompt_tokens,
            output_tokens=event.completion_tokens,
            estimated_cost_usd=event.estimated_cost_usd,
            latency_ms=event.latency_ms,
            success=event.success,
            request_id=event.request_id,
        )
        self._emit(record)
        metrics.record_ai_usage(record)
        return record

    def _emit(self, record: AIUsageRecord) -> None:
        logger.info(
            "[cost] model=%s type=%s user=%s video=%s in=%s out=%s cost=$%.6f latency=%dms ok=%s",
            record.model,
            record.request_type,
            (record.user_id or "-")[:8],
            record.video_id,
            record.input_tokens,
            record.output_tokens,
            record.estimated_cost_usd,
            record.latency_ms,
            record.success,
        )
        if self.sink is None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop is not None:
            task = loop.create_task(self._safe_sink(record))
            self._pending.append(task)
            task.add_done_callback(lambda t: self._pending.remove(t) if t in self._pending else None)
        else:  # pragma: no cover - only in non-async contexts
            logger.debug("[cost] no event loop; usage not persisted")

    async def _safe_sink(self, record: AIUsageRecord) -> None:
        try:
            assert self.sink is not None
            await self.sink(record)
        except Exception:  # noqa: BLE001 - accounting must never break the product
            logger.warning("[cost] failed to persist usage record", exc_info=True)

    async def aclose(self) -> None:
        if self._pending:
            await asyncio.gather(*self._pending, return_exceptions=True)
        self._pending.clear()
