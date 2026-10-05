"""AI usage accounting tests."""

from __future__ import annotations

from app.services.ai.base import UsageEvent
from app.services.ai.usage import AIUsageRecorder
from app.services.metrics import metrics


async def test_recorder_persists_and_accumulates() -> None:
    saved: list[object] = []

    async def sink(record) -> None:  # noqa: ANN001
        saved.append(record)

    recorder = AIUsageRecorder(sink=sink)
    recorder.record(
        UsageEvent(
            model="gemini-main",
            request_type="chat_complex",
            prompt_tokens=1000,
            completion_tokens=200,
            latency_ms=42,
            estimated_cost_usd=0.0012,
            request_id="req-1",
        ),
        user_id="user-1",
        video_id="dQw4w9WgXcQ",
    )
    await recorder.aclose()
    assert len(saved) == 1
    record = saved[0]
    assert record.user_id == "user-1"
    assert record.video_id == "dQw4w9WgXcQ"
    assert record.input_tokens == 1000
    assert record.output_tokens == 200
    assert record.request_type == "chat_complex"
    assert record.to_row()["model"] == "gemini-main"


async def test_recorder_counts_failures_without_tokens() -> None:
    recorder = AIUsageRecorder()
    before = metrics.snapshot()
    recorder.record(
        UsageEvent(
            model="gemini-main",
            request_type="guide",
            prompt_tokens=None,
            completion_tokens=None,
            latency_ms=5,
            estimated_cost_usd=0.0,
            success=False,
        )
    )
    after = metrics.snapshot()
    assert after["ai_errors"] == before["ai_errors"] + 1
    assert after["ai_output_tokens"] == before["ai_output_tokens"]


async def test_recorder_survives_sink_failure() -> None:
    async def broken_sink(record) -> None:  # noqa: ANN001
        raise RuntimeError("db down")

    recorder = AIUsageRecorder(sink=broken_sink)
    recorder.record(
        UsageEvent(
            model="gemini-fast",
            request_type="summary",
            prompt_tokens=1,
            completion_tokens=1,
            latency_ms=1,
            estimated_cost_usd=0.0,
        )
    )
    # Must not raise even though the sink failed.
    await recorder.aclose()
