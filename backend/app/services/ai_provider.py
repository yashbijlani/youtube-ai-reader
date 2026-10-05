"""AIProvider abstraction.

The rest of the app talks to ``AIProvider`` only. The default implementation,
``OpenAICompatibleProvider``, speaks the OpenAI-compatible chat-completions
protocol used by OpenCode Zen, Google Gemini, OpenAI, Ollama, LM Studio, vLLM,
and others. Adding a native provider later means adding a class here.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.config import Settings
from app.errors import (
    AIAccessDenied,
    AIFundingError,
    AIModelUnavailable,
    AIProviderError,
)
from app.services.metrics import metrics

logger = logging.getLogger("youtube_ai_reader.ai")


@dataclass
class CompletionResult:
    text: str
    model: str
    input_chars: int = 0
    output_chars: int = 0
    latency_ms: int = 0
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class AIProvider(ABC):
    """Model-agnostic interface: one completion call, one streaming call."""

    model: str

    @abstractmethod
    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        json_mode: bool = False,
        max_tokens: int | None = None,
        temperature: float | None = None,
        model: str | None = None,
    ) -> CompletionResult:
        ...

    @abstractmethod
    def stream(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
        model: str | None = None,
    ) -> AsyncIterator[str]:
        ...

    async def aclose(self) -> None:  # pragma: no cover - trivial
        return None

    async def preflight(self) -> None:
        """Cheap check that the provider is usable; default no-op."""
        return None


class OpenAICompatibleProvider(AIProvider):
    """OpenAI-compatible HTTP provider (Gemini, OpenCode Zen, OpenAI, local...)."""

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.model = settings.opencode_model
        base = settings.opencode_base_url.rstrip("/")
        self.chat_url = base if base.endswith("/chat/completions") else f"{base}/chat/completions"
        self._client = client
        self._owns_client = client is None
        self._semaphore = asyncio.Semaphore(max(1, settings.opencode_max_concurrency))
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
        # Probe the fast model: it is cheaper and usually more available; the
        # point is only to catch terminal key/funding/model errors early.
        probe_model = self.settings.opencode_fast_model or self.model
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
            # Network blips are transient; don't block the job.
            logger.warning("[ai] preflight transport error: %s", type(exc).__name__)
            self._preflight_ok_until = now + 30
            return
        if response.status_code >= 400:
            error = _classify_error(response.status_code, _error_detail(response), probe_model)
            if error.terminal:
                self._preflight_error = error
                self._preflight_error_until = now + 120
                logger.warning("[ai] preflight failed: %s (%s)", error.code, error.message)
                raise error
            # Transient (429/5xx): let the real calls retry.
            logger.warning("[ai] preflight transient HTTP %d; continuing", response.status_code)
            self._preflight_ok_until = now + 30
            return
        self._preflight_ok_until = now + 120
        self._preflight_error = None
        logger.info("[ai] preflight ok model=%s", probe_model)

    def _headers(self) -> dict[str, str]:
        if not self.settings.opencode_api_key:
            from app.errors import AIProviderNotConfigured

            raise AIProviderNotConfigured()
        return {
            "Authorization": f"Bearer {self.settings.opencode_api_key}",
            "Content-Type": "application/json",
        }

    def _payload(
        self,
        messages: list[dict[str, str]],
        *,
        json_mode: bool,
        max_tokens: int | None,
        temperature: float | None,
        stream: bool,
        model: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": model or self.model,
            "messages": messages,
            "temperature": (
                self.settings.ai_temperature if temperature is None else temperature
            ),
            "max_tokens": max_tokens or self.settings.ai_max_output_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        if stream:
            payload["stream"] = True
        return payload

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            timeout = httpx.Timeout(
                self.settings.opencode_timeout_seconds,
                connect=self.settings.opencode_connect_timeout_seconds,
            )
            self._client = httpx.AsyncClient(timeout=timeout)
            self._owns_client = True
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        json_mode: bool = False,
        max_tokens: int | None = None,
        temperature: float | None = None,
        model: str | None = None,
    ) -> CompletionResult:
        client = await self._ensure_client()
        payload = self._payload(
            messages,
            json_mode=json_mode,
            max_tokens=max_tokens,
            temperature=temperature,
            stream=False,
            model=model,
        )
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
                logger.warning("[ai] timeout model=%s attempt=%s", self.model, attempts)
                await asyncio.sleep(0.8 * attempts)
                continue
            except httpx.HTTPError as exc:
                last_error = exc
                logger.warning("[ai] transport error model=%s error=%s", self.model, type(exc).__name__)
                await asyncio.sleep(0.8 * attempts)
                continue

            if response.status_code == 400 and json_mode:
                # Some models reject response_format; retry once without it.
                payload.pop("response_format", None)
                json_mode = False
                continue
            if response.status_code in (408, 429, 500, 502, 503, 504) and attempts <= self.settings.ai_max_retries:
                last_error = AIProviderError(
                    f"The AI service is busy (HTTP {response.status_code})."
                )
                backoff = min(10.0, 2.0 * attempts) + random.uniform(0, 0.75)
                logger.warning(
                    "[ai] busy (HTTP %d); backing off %.1fs (attempt %d/%d)",
                    response.status_code,
                    backoff,
                    attempts,
                    self.settings.ai_max_retries,
                )
                await asyncio.sleep(backoff)
                continue
            if response.status_code >= 400:
                detail = _error_detail(response)
                metrics.record_ai_call(self.model, input_chars, 0, error=True)
                raise _classify_error(response.status_code, detail, self.model)

            try:
                data = response.json()
                choice = data["choices"][0]
                text = choice["message"]["content"] or ""
                finish_reason = choice.get("finish_reason")
            except (KeyError, IndexError, ValueError, TypeError) as exc:
                metrics.record_ai_call(self.model, input_chars, 0, error=True)
                raise AIProviderError("The AI service returned an unexpected response.") from exc

            if not text.strip():
                # Reasoning models can burn the whole budget on hidden reasoning and
                # return empty content. Retry once with a bigger budget.
                last_error = AIProviderError("The AI service returned an empty response.")
                if attempts <= self.settings.ai_max_retries:
                    current = int(payload.get("max_tokens") or self.settings.ai_max_output_tokens)
                    if finish_reason == "length" or finish_reason is None:
                        payload["max_tokens"] = min(
                            self.settings.ai_hard_max_output_tokens, current * 2
                        )
                        logger.warning(
                            "[ai] empty content (finish=%s), retrying with max_tokens=%s",
                            finish_reason,
                            payload["max_tokens"],
                        )
                    continue
                metrics.record_ai_call(self.model, input_chars, 0, error=True)
                raise last_error

            latency_ms = int((time.monotonic() - started) * 1000)
            usage = data.get("usage") or {}
            effective_model = data.get("model") or model or self.model
            result = CompletionResult(
                text=text,
                model=effective_model,
                input_chars=input_chars,
                output_chars=len(text),
                latency_ms=latency_ms,
                prompt_tokens=usage.get("prompt_tokens"),
                completion_tokens=usage.get("completion_tokens"),
                extra={"finish_reason": finish_reason},
            )
            metrics.record_ai_call(effective_model, input_chars, len(text))
            logger.info(
                "[ai] completion model=%s in=%dc out=%dc latency=%dms",
                effective_model,
                input_chars,
                len(text),
                latency_ms,
            )
            return result

        metrics.record_ai_call(self.model, input_chars, 0, error=True)
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
    ) -> AsyncIterator[str]:
        client = await self._ensure_client()
        payload = self._payload(
            messages,
            json_mode=False,
            max_tokens=max_tokens,
            temperature=temperature,
            stream=True,
            model=model,
        )
        input_chars = sum(len(m.get("content", "")) for m in messages)
        output_chars = 0
        started = time.monotonic()
        attempts = 0
        while attempts <= self.settings.ai_max_retries:
            attempts += 1
            yielded_any = False
            try:
                async with self._semaphore:
                    async with client.stream(
                        "POST", self.chat_url, headers=self._headers(), json=payload
                    ) as response:
                        if response.status_code >= 400:
                            body = await response.aread()
                            raise _classify_error(
                                response.status_code, _error_detail_bytes(body), self.model
                            )
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
                            delta = choices[0].get("delta") or {}
                            piece = delta.get("content")
                            if piece:
                                output_chars += len(piece)
                                yielded_any = True
                                yield piece
                break
            except (httpx.HTTPError, AIProviderError) as exc:
                retryable = (
                    isinstance(exc, httpx.HTTPError)
                    or not getattr(exc, "terminal", False)
                )
                if yielded_any or not retryable or attempts > self.settings.ai_max_retries:
                    metrics.record_ai_call(self.model, input_chars, output_chars, error=True)
                    if isinstance(exc, AIProviderError):
                        raise
                    raise AIProviderError("The AI stream was interrupted.") from exc
                logger.warning("[ai] stream retry %d/%d: %s", attempts, self.settings.ai_max_retries, exc)
                await asyncio.sleep(min(10.0, 2.0 * attempts) + random.uniform(0, 0.75))
        effective_model = model or self.model
        metrics.record_ai_call(effective_model, input_chars, output_chars)
        logger.info(
            "[ai] stream model=%s in=%dc out=%dc latency=%dms",
            effective_model,
            input_chars,
            output_chars,
            int((time.monotonic() - started) * 1000),
        )


# Backwards-compatible alias: the provider is generic OpenAI-compatible.
OpenCodeAIProvider = OpenAICompatibleProvider


# ------------------------------------------------------------------ helpers


def _classify_error(status: int, detail: str, model: str) -> AIProviderError:
    """Map an HTTP status to a typed, terminal-aware provider error."""
    if status == 401:
        return AIAccessDenied()
    if status == 402:
        return AIFundingError()
    if status == 403:
        return AIAccessDenied()
    if status == 404:
        return AIModelUnavailable(model)
    if status in (408, 429):
        return AIProviderError(f"The AI service is busy (HTTP {status}).")
    if status >= 500:
        return AIProviderError(f"The AI service failed (HTTP {status}): {detail}")
    return AIProviderError(f"AI request failed (HTTP {status}): {detail}")


def _extract_error_message(data: Any) -> str | None:
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])
        if isinstance(error, str):
            return error
        if data.get("message"):
            return str(data["message"])
    if isinstance(data, list) and data:
        return _extract_error_message(data[0])
    return None


def _error_detail(response: httpx.Response) -> str:
    try:
        message = _extract_error_message(response.json())
        if message:
            return message[:300]
        return response.text[:300]
    except ValueError:
        return response.text[:300] or "empty response"


def _error_detail_bytes(body: bytes) -> str:
    try:
        message = _extract_error_message(json.loads(body))
        if message:
            return message[:300]
        return body.decode("utf-8", errors="replace")[:300]
    except (ValueError, TypeError):
        return body.decode("utf-8", errors="replace")[:300]


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)


def extract_json(text: str) -> dict[str, Any]:
    """Pull a JSON object out of a model response, tolerating fences/preamble.

    Raises ``ValueError`` when no object can be recovered.
    """
    if text is None:
        raise ValueError("empty response")
    candidates: list[str] = []
    stripped = text.strip()
    if stripped:
        candidates.append(stripped)
    for match in _FENCE_RE.finditer(text):
        candidates.append(match.group(1).strip())
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])

    for candidate in candidates:
        parsed = _try_loads(candidate)
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("no JSON object found in model output")


def _try_loads(candidate: str) -> Any:
    for attempt in (candidate, _repair(candidate)):
        if attempt is None:
            continue
        try:
            return json.loads(attempt)
        except (json.JSONDecodeError, TypeError):
            continue
    return None


def _repair(candidate: str) -> str | None:
    if not candidate:
        return None
    text = candidate
    text = re.sub(r",\s*([}\]])", r"\1", text)  # trailing commas
    text = re.sub(r"(?<![\w\"])'([^'\n]*)'(?![\w])", r'"\1"', text)  # naive quote fix
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    return text
