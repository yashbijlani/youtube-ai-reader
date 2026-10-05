"""Gemini provider, routing, and cost-accounting tests (no network)."""

from __future__ import annotations

import json

import httpx
import pytest

from app.config import Settings
from app.errors import AIAccessDenied, AIFundingError, AIProviderError
from app.services.ai import (
    AIRequestType,
    GeminiProvider,
    create_provider,
    route_model,
)
from app.services.ai.routing import estimate_cost_usd


def _settings() -> Settings:
    settings = Settings(_env_file=None)
    settings.gemini_api_key = "test-key"
    settings.gemini_model_main = "gemini-main"
    settings.gemini_model_fast = "gemini-fast"
    settings.ai_price_main_input = 1.0
    settings.ai_price_main_output = 2.0
    settings.ai_price_fast_input = 0.1
    settings.ai_price_fast_output = 0.2
    settings.gemini_max_concurrency = 2
    return settings


def test_route_model_tiers() -> None:
    settings = _settings()
    assert route_model(AIRequestType.ANALYSIS, settings) == "gemini-fast"
    assert route_model(AIRequestType.SUMMARY, settings) == "gemini-fast"
    assert route_model(AIRequestType.CLASSIFICATION, settings) == "gemini-fast"
    assert route_model(AIRequestType.CHAT_SIMPLE, settings) == "gemini-fast"
    assert route_model(AIRequestType.GUIDE, settings) == "gemini-main"
    assert route_model(AIRequestType.CHAT_COMPLEX, settings) == "gemini-main"


def test_estimate_cost_uses_tier_prices() -> None:
    settings = _settings()
    # 1M in + 1M out on the main model
    assert estimate_cost_usd(settings, model="gemini-main", prompt_tokens=1_000_000, completion_tokens=1_000_000) == 3.0
    # fast model is cheaper
    assert estimate_cost_usd(settings, model="gemini-fast", prompt_tokens=1_000_000, completion_tokens=1_000_000) == pytest.approx(0.3)
    assert estimate_cost_usd(settings, model="gemini-main", prompt_tokens=None, completion_tokens=None) == 0.0


def test_create_provider_defaults_to_gemini() -> None:
    provider = create_provider(_settings())
    assert isinstance(provider, GeminiProvider)
    assert provider.model == "gemini-main"


def _gemini_response(text: str = "hello", prompt: int = 100, completion: int = 20) -> dict:
    return {
        "candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}],
        "usageMetadata": {"promptTokenCount": prompt, "candidatesTokenCount": completion},
    }


async def test_gemini_complete_returns_text_and_authoritative_usage() -> None:
    settings = _settings()
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json=_gemini_response("the answer", 100, 20))

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = GeminiProvider(settings, client=client)
    result = await provider.complete(
        [{"role": "system", "content": "sys"}, {"role": "user", "content": "hi"}],
        json_mode=True,
        request_type=AIRequestType.CHAT_COMPLEX,
    )
    assert result.text == "the answer"
    assert result.model == "gemini-main"
    assert result.prompt_tokens == 100
    assert result.completion_tokens == 20
    assert result.estimated_cost_usd == pytest.approx(100 / 1e6 * 1.0 + 20 / 1e6 * 2.0)
    # request carried systemInstruction + JSON mime type + api key header
    assert seen[0]["systemInstruction"]["parts"][0]["text"] == "sys"
    assert seen[0]["generationConfig"]["responseMimeType"] == "application/json"
    await client.aclose()


async def test_gemini_complete_routes_fast_tier_and_emits_usage() -> None:
    settings = _settings()
    urls: list[str] = []
    events: list[object] = []

    def handler(request: httpx.Request) -> httpx.Response:
        urls.append(str(request.url))
        return httpx.Response(200, json=_gemini_response("s", 10, 5))

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = GeminiProvider(settings, client=client)
    await provider.complete(
        [{"role": "user", "content": "x"}],
        request_type=AIRequestType.SUMMARY,
        on_usage=events.append,
    )
    assert "gemini-fast:generateContent" in urls[0]
    assert events and events[0].success is True
    assert events[0].request_type == "summary"
    await client.aclose()


async def test_gemini_stream_yields_pieces_and_usage() -> None:
    settings = _settings()
    events: list[object] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = (
            'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}\n\n'
            'data: {"candidates":[{"content":{"parts":[{"text":"world"}]}}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":2}}\n\n'
        )
        return httpx.Response(200, headers={"Content-Type": "text/event-stream"}, content=body)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = GeminiProvider(settings, client=client)
    pieces = [
        piece
        async for piece in provider.stream(
            [{"role": "user", "content": "x"}],
            request_type=AIRequestType.GUIDE,
            on_usage=events.append,
        )
    ]
    assert "".join(pieces) == "Hello world"
    assert events and events[0].prompt_tokens == 7 and events[0].completion_tokens == 2
    await client.aclose()


async def test_gemini_terminal_errors_are_classified() -> None:
    settings = _settings()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": {"message": "permission denied"}})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = GeminiProvider(settings, client=client)
    with pytest.raises(AIAccessDenied):
        await provider.complete([{"role": "user", "content": "x"}])
    await client.aclose()


async def test_gemini_retries_transient_errors() -> None:
    settings = _settings()
    settings.ai_max_retries = 1
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, json={"error": {"message": "busy"}})
        return httpx.Response(200, json=_gemini_response("ok"))

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = GeminiProvider(settings, client=client)
    result = await provider.complete([{"role": "user", "content": "x"}])
    assert result.text == "ok"
    assert calls["n"] == 2
    await client.aclose()


async def test_gemini_invalid_key_400_is_access_denied() -> None:
    settings = _settings()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "API key not valid. Please pass a valid API key."}})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = GeminiProvider(settings, client=client)
    with pytest.raises(AIAccessDenied):
        await provider.complete([{"role": "user", "content": "x"}])
    await client.aclose()


async def test_gemini_preflight_terminal_funding_fails_fast() -> None:
    settings = _settings()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(402, json={"error": {"message": "no funds"}})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = GeminiProvider(settings, client=client)
    with pytest.raises(AIFundingError):
        await provider.preflight()
    await client.aclose()


def test_provider_error_defaults_transient() -> None:
    assert AIProviderError("busy").terminal is False
