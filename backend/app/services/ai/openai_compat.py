"""OpenAI-compatible provider — development/local escape hatch.

Production uses ``GeminiProvider``. This remains for local models (Ollama,
vLLM, LM Studio, …) and for the existing provider tests.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from collections.abc import AsyncIterator

import httpx

from app.config import Settings
from app.errors import AIProviderError
from app.services.ai.base import (
    AIProvider,
    CompletionResult,
    UsageCallback,
    UsageEvent,
    classify_error,
    error_detail,
    error_detail_bytes,
)
from app.services.ai.routing import (
    AIRequestType,
    estimate_cost_usd,
    max_tokens_for,
    route_model,
)

logger = logging.getLogger("youtube_ai_reader.ai.openai_compat")


class OpenAICompatibleProvider(AIProvider):
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.model = settings.gemini_model_main
        base = settings.gemini_base_url.rstrip("/")
        self.chat_url = base if base.endswith("/chat/completions") else f"{base}/chat/completions"
        self._client = client
        self._owns_client = client is None
        self._semaphore = asyncio.Semaphore(max(1, settings.gemini_max_concurrency))
        self._preflight_ok_until = 0.0
        self._preflight_error: AIProviderError | None = None
        self._preflight_error_until = 0.0

    async def preflight(self) -> None:
        if not self.settings.ai_preflight_enabled:
            return
        now = time.monotonic()
        if self._preflight_ok_until > now:
            return
        if self._preflight_error is not None and self._preflight_error_until > now:
            raise self._preflight_error
        client = await self._ensure_client()
        probe_model = self.settings.gemini_model_fast or self.model
        payload = {
            "model": probe_model,
            "messages": [{"role": "user", "content": "ok"}],
            "max_tokens": 4,
            "temperature": 0.0,
        }
        try:
            async with self._semaphore:
                response = await client.post(self.chat_url, headers=self._headers(), json=payload)
        except httpx.HTTPError as exc:
            logger.warning("[ai] preflight transport error: %s", type(exc).__name__)
            self._preflight_ok_until = now + 30
            return
        if response.status_code >= 400:
            error = classify_error(response.status_code, error_detail(response), probe_model)
            if error.terminal:
                self._preflight_error = error
                self._preflight_error_until = now + 120
                raise error
            self._preflight_ok_until = now + 30
            return
        self._preflight_ok_until = now + 120
        self._preflight_error = None

    def _headers(self) -> dict[str, str]:
        if not self.settings.gemini_api_key:
            from app.errors import AIProviderNotConfigured

            raise AIProviderNotConfigured()
        return {
            "Authorization": f"Bearer {self.settings.gemini_api_key}",
            "Content-Type": "application/json",
        }

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            timeout = httpx.Timeout(
                self.settings.gemini_timeout_seconds,
                connect=self.settings.gemini_connect_timeout_seconds,
            )
            self._client = httpx.AsyncClient(timeout=timeout)
            self._owns_client = True
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    def _model_for(self, request_type: AIRequestType | None, model: str | None) -> str:
        if model:
            return model
        if request_type is None:
            return self.model
        return route_model(request_type, self.settings)

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        json_mode: bool = False,
        max_tokens: int | None = None,
        temperature: float | None = None,
        model: str | None = None,
        request_type: AIRequestType | None = None,
        on_usage: UsageCallback | None = None,
    ) -> CompletionResult:
        client = await self._ensure_client()
        rtype = request_type or AIRequestType.CHAT_COMPLEX
        effective_model = self._model_for(request_type, model)
        payload: dict = {
            "model": effective_model,
            "messages": messages,
            "temperature": self.settings.ai_temperature if temperature is None else temperature,
            "max_tokens": max_tokens_for(rtype, self.settings, max_tokens),
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        input_chars = sum(len(m.get("content", "")) for m in messages)
        attempts = 0
        last_error: Exception | None = None
        started = time.monotonic()

        while attempts <= self.settings.ai_max_retries:
            attempts += 1
            try:
                async with self._semaphore:
                    response = await client.post(self.chat_url, headers=self._headers(), json=payload)
            except httpx.TimeoutException as exc:
                last_error = exc
                await asyncio.sleep(0.8 * attempts)
                continue
            except httpx.HTTPError as exc:
                last_error = exc
                await asyncio.sleep(0.8 * attempts)
                continue
            if response.status_code == 400 and json_mode:
                payload.pop("response_format", None)
                json_mode = False
                continue
            if response.status_code in (408, 429, 500, 502, 503, 504) and attempts <= self.settings.ai_max_retries:
                last_error = AIProviderError(f"The AI service is busy (HTTP {response.status_code}).")
                await asyncio.sleep(min(10.0, 2.0 * attempts) + random.uniform(0, 0.75))
                continue
            if response.status_code >= 400:
                raise classify_error(response.status_code, error_detail(response), effective_model)
            try:
                data = response.json()
                choice = data["choices"][0]
                text = choice["message"]["content"] or ""
                finish_reason = choice.get("finish_reason")
            except (KeyError, IndexError, ValueError, TypeError) as exc:
                raise AIProviderError("The AI service returned an unexpected response.") from exc
            if not text.strip():
                last_error = AIProviderError("The AI service returned an empty response.")
                if attempts <= self.settings.ai_max_retries:
                    current = int(payload.get("max_tokens") or self.settings.ai_max_output_tokens)
                    if finish_reason == "length" or finish_reason is None:
                        payload["max_tokens"] = min(self.settings.ai_hard_max_output_tokens, current * 2)
                    continue
                raise last_error
            usage = data.get("usage") or {}
            prompt_tokens = usage.get("prompt_tokens")
            completion_tokens = usage.get("completion_tokens")
            latency_ms = int((time.monotonic() - started) * 1000)
            result = CompletionResult(
                text=text,
                model=data.get("model") or effective_model,
                input_chars=input_chars,
                output_chars=len(text),
                latency_ms=latency_ms,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                estimated_cost_usd=estimate_cost_usd(
                    self.settings, model=effective_model, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
                ),
                request_type=rtype.value,
                extra={"finish_reason": finish_reason},
            )
            if on_usage:
                on_usage(
                    UsageEvent(
                        model=result.model,
                        request_type=rtype.value,
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        latency_ms=latency_ms,
                        estimated_cost_usd=result.estimated_cost_usd,
                        success=True,
                    )
                )
            return result
        if isinstance(last_error, AIProviderError):
            raise last_error
        raise AIProviderError("The AI service did not respond in time.")

    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
        model: str | None = None,
        request_type: AIRequestType | None = None,
        on_usage: UsageCallback | None = None,
    ) -> AsyncIterator[str]:
        client = await self._ensure_client()
        rtype = request_type or AIRequestType.CHAT_COMPLEX
        effective_model = self._model_for(request_type, model)
        payload: dict = {
            "model": effective_model,
            "messages": messages,
            "temperature": self.settings.ai_temperature if temperature is None else temperature,
            "max_tokens": max_tokens_for(rtype, self.settings, max_tokens),
            "stream": True,
        }
        input_chars = sum(len(m.get("content", "")) for m in messages)
        output_chars = 0
        started = time.monotonic()
        attempts = 0
        while attempts <= self.settings.ai_max_retries:
            attempts += 1
            yielded_any = False
            try:
                async with self._semaphore:
                    async with client.stream("POST", self.chat_url, headers=self._headers(), json=payload) as response:
                        if response.status_code >= 400:
                            body = await response.aread()
                            raise classify_error(response.status_code, error_detail_bytes(body), effective_model)
                        async for line in response.aiter_lines():
                            if not line or not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if not data or data == "[DONE]":
                                continue
                            try:
                                event = json.loads(data)
                            except json.JSONDecodeError:
                                continue
                            choices = event.get("choices") or []
                            if not choices:
                                continue
                            piece = (choices[0].get("delta") or {}).get("content")
                            if piece:
                                output_chars += len(piece)
                                yielded_any = True
                                yield piece
                break
            except (httpx.HTTPError, AIProviderError) as exc:
                retryable = isinstance(exc, httpx.HTTPError) or not getattr(exc, "terminal", False)
                if yielded_any or not retryable or attempts > self.settings.ai_max_retries:
                    if isinstance(exc, AIProviderError):
                        raise
                    raise AIProviderError("The AI stream was interrupted.") from exc
                await asyncio.sleep(min(10.0, 2.0 * attempts) + random.uniform(0, 0.75))
        if on_usage:
            on_usage(
                UsageEvent(
                    model=effective_model,
                    request_type=rtype.value,
                    prompt_tokens=None,
                    completion_tokens=None,
                    latency_ms=int((time.monotonic() - started) * 1000),
                    estimated_cost_usd=0.0,
                    success=True,
                )
            )
