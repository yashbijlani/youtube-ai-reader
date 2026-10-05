"""AI provider error classification and stream retry tests."""

from __future__ import annotations

import httpx
import pytest

from app.config import Settings
from app.errors import (
    AIAccessDenied,
    AIFundingError,
    AIModelUnavailable,
    AIProviderError,
)
from app.services.ai_provider import OpenAICompatibleProvider, _classify_error


def test_classify_terminal_errors() -> None:
    assert isinstance(_classify_error(402, "no funds", "m"), AIFundingError)
    assert isinstance(_classify_error(401, "bad key", "m"), AIAccessDenied)
    assert isinstance(_classify_error(403, "forbidden", "m"), AIAccessDenied)
    assert isinstance(_classify_error(404, "missing", "m"), AIModelUnavailable)
    for status in (429, 500, 503):
        error = _classify_error(status, "busy", "m")
        assert isinstance(error, AIProviderError)
        assert error.terminal is False
    assert AIFundingError().terminal is True


async def test_stream_retries_then_succeeds() -> None:
    settings = Settings(_env_file=None)
    settings.opencode_api_key = "test"
    settings.ai_max_retries = 1
    settings.opencode_max_concurrency = 2
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] == 1:
            return httpx.Response(429, json={"error": {"message": "rate limited"}})
        return httpx.Response(
            200,
            headers={"Content-Type": "text/event-stream"},
            content='data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = OpenAICompatibleProvider(settings, client=client)
    chunks = [piece async for piece in provider.stream([{"role": "user", "content": "x"}])]
    assert "".join(chunks) == "hi"
    assert calls["count"] == 2
    await client.aclose()


async def test_stream_does_not_retry_terminal_error() -> None:
    settings = Settings(_env_file=None)
    settings.opencode_api_key = "test"
    settings.ai_max_retries = 2
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(402, json={"error": {"message": "no funds"}})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = OpenAICompatibleProvider(settings, client=client)
    with pytest.raises(AIFundingError):
        async for _ in provider.stream([{"role": "user", "content": "x"}]):
            pass
    assert calls["count"] == 1
    await client.aclose()
