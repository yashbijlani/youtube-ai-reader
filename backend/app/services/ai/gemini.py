"""Native Google Gemini provider (production).

Speaks the Gemini REST API directly:

    POST {base}/models/{model}:generateContent
    POST {base}/models/{model}:streamGenerateContent?alt=sse

No OpenAI-compatibility layer, no third-party gateway. The API key is sent in
the ``x-goog-api-key`` header and never leaves the server.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
import uuid
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
    temperature_for,
)

logger = logging.getLogger("youtube_ai_reader.ai.gemini")


def _to_gemini_messages(
    messages: list[dict[str, str]],
) -> tuple[dict | None, list[dict]]:
    """Convert OpenAI-style messages to Gemini systemInstruction + contents."""
    system_parts: list[dict] = []
    contents: list[dict] = []
    for message in messages:
        role = message.get("role")
        text = message.get("content") or ""
        if not text:
            continue
        if role == "system":
            system_parts.append({"text": text})
            continue
        gemini_role = "model" if role == "assistant" else "user"
        if contents and contents[-1]["role"] == gemini_role:
            # Gemini expects alternating roles; merge consecutive turns.
            contents[-1]["parts"].append({"text": text})
        else:
            contents.append({"role": gemini_role, "parts": [{"text": text}]})
    system = {"parts": system_parts} if system_parts else None
    return system, contents


def _extract_text(data: dict) -> str:
    candidates = data.get("candidates") or []
    if not candidates:
        return ""
    parts = (candidates[0].get("content") or {}).get("parts") or []
    return "".join(part.get("text") or "" for part in parts)


def _usage_of(data: dict) -> tuple[int | None, int | None]:
    usage = data.get("usageMetadata") or {}
    return usage.get("promptTokenCount"), usage.get("candidatesTokenCount")


def _finish_reason(data: dict) -> str | None:
    candidates = data.get("candidates") or []
    return candidates[0].get("finishReason") if candidates else None


class GeminiProvider(AIProvider):
    """Production provider: direct Gemini API with routing and usage capture."""

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.model = settings.gemini_model_main
        self._base = settings.gemini_base_url.rstrip("/")
        self._client = client
        self._owns_client = client is None
        self._semaphore = asyncio.Semaphore(max(1, settings.gemini_max_concurrency))
        self._preflight_ok_until = 0.0
        self._preflight_error: AIProviderError | None = None
        self._preflight_error_until = 0.0

    # ------------------------------------------------------------- helpers

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            timeout = httpx.Timeout(
                self.settings.gemini_timeout_seconds,
                connect=self.settings.gemini_connect_timeout_seconds,
            )
            self._client = httpx.AsyncClient(timeout=timeout)
            self._owns_client = True
        return self._client

    def _headers(self) -> dict[str, str]:
        if not self.settings.gemini_api_key:
            from app.errors import AIProviderNotConfigured

            raise AIProviderNotConfigured()
        return {
            "x-goog-api-key": self.settings.gemini_api_key,
            "Content-Type": "application/json",
        }

    def _payload(
        self,
        messages: list[dict[str, str]],
        *,
        json_mode: bool,
        max_tokens: int | None,
        temperature: float | None,
    ) -> dict:
        system, contents = _to_gemini_messages(messages)
        generation_config: dict = {
            "temperature": self.settings.ai_temperature if temperature is None else temperature,
            "maxOutputTokens": max_tokens or self.settings.ai_max_output_tokens,
        }
        if json_mode:
            generation_config["responseMimeType"] = "application/json"
        payload: dict = {"contents": contents, "generationConfig": generation_config}
        if system:
            payload["systemInstruction"] = system
        return payload

    def _model_for(self, request_type: AIRequestType | None, model: str | None) -> str:
        if model:
            return model
        if request_type is None:
            return self.model
        return route_model(request_type, self.settings)

    async def aclose(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------ preflight

    async def preflight(self) -> None:
        if not self.settings.ai_preflight_enabled:
            return
        now = time.monotonic()
        if self._preflight_ok_until > now:
            return
        if self._preflight_error is not None and self._preflight_error_until > now:
            raise self._preflight_error
        client = await self._ensure_client()
        model = self.settings.effective_fast_model
        payload = {
            "contents": [{"role": "user", "parts": [{"text": "ok"}]}],
            "generationConfig": {"temperature": 0.0, "maxOutputTokens": 4},
        }
        try:
            async with self._semaphore:
                response = await client.post(
                    f"{self._base}/models/{model}:generateContent",
                    headers=self._headers(),
                    json=payload,
                )
        except httpx.HTTPError as exc:
            logger.warning("[ai] preflight transport error: %s", type(exc).__name__)
            self._preflight_ok_until = now + 30
            return
        if response.status_code >= 400:
            error = classify_error(response.status_code, error_detail(response), model)
            if error.terminal:
                self._preflight_error = error
                self._preflight_error_until = now + 120
                logger.warning("[ai] preflight failed: %s (%s)", error.code, error.message)
                raise error
            logger.warning("[ai] preflight transient HTTP %d; continuing", response.status_code)
            self._preflight_ok_until = now + 30
            return
        self._preflight_ok_until = now + 120
        self._preflight_error = None
        logger.info("[ai] preflight ok model=%s", model)

    # ------------------------------------------------------------- complete

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
        budget = max_tokens_for(rtype, self.settings, max_tokens)
        payload = self._payload(
            messages,
            json_mode=json_mode,
            max_tokens=budget,
            temperature=temperature if temperature is not None else temperature_for(rtype, self.settings),
        )
        input_chars = sum(len(m.get("content", "")) for m in messages)
        request_id = str(uuid.uuid4())
        attempts = 0
        last_error: Exception | None = None
        started = time.monotonic()
        url = f"{self._base}/models/{effective_model}:generateContent"

        while attempts <= self.settings.ai_max_retries:
            attempts += 1
            try:
                async with self._semaphore:
                    response = await client.post(url, headers=self._headers(), json=payload)
            except httpx.TimeoutException as exc:
                last_error = exc
                logger.warning("[ai] timeout model=%s attempt=%s", effective_model, attempts)
                await asyncio.sleep(0.8 * attempts)
                continue
            except httpx.HTTPError as exc:
                last_error = exc
                logger.warning("[ai] transport error model=%s error=%s", effective_model, type(exc).__name__)
                await asyncio.sleep(0.8 * attempts)
                continue

            if response.status_code == 400 and json_mode and "responseMimeType" in json.dumps(payload.get("generationConfig", {})):
                # Some models reject responseMimeType; retry once without it.
                payload.get("generationConfig", {}).pop("responseMimeType", None)
                json_mode = False
                continue
            if response.status_code in (408, 429, 500, 502, 503, 504) and attempts <= self.settings.ai_max_retries:
                last_error = AIProviderError(f"The AI service is busy (HTTP {response.status_code}).")
                backoff = min(10.0, 2.0 * attempts) + random.uniform(0, 0.75)
                logger.warning("[ai] busy (HTTP %d); backing off %.1fs", response.status_code, backoff)
                await asyncio.sleep(backoff)
                continue
            if response.status_code >= 400:
                raise classify_error(response.status_code, error_detail(response), effective_model)

            try:
                data = response.json()
            except ValueError as exc:
                raise AIProviderError("The AI service returned an unexpected response.") from exc

            text = _extract_text(data)
            prompt_tokens, completion_tokens = _usage_of(data)
            if not text.strip():
                last_error = AIProviderError("The AI service returned an empty response.")
                if attempts <= self.settings.ai_max_retries:
                    current = int(payload["generationConfig"].get("maxOutputTokens") or budget)
                    finish = _finish_reason(data)
                    if finish == "MAX_TOKENS" or finish is None:
                        payload["generationConfig"]["maxOutputTokens"] = min(
                            self.settings.ai_hard_max_output_tokens, current * 2
                        )
                        logger.warning("[ai] empty content (finish=%s), retrying with maxOutputTokens=%s", finish, payload["generationConfig"]["maxOutputTokens"])
                    continue
                raise last_error

            latency_ms = int((time.monotonic() - started) * 1000)
            cost = estimate_cost_usd(
                self.settings,
                model=effective_model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            )
            result = CompletionResult(
                text=text,
                model=effective_model,
                input_chars=input_chars,
                output_chars=len(text),
                latency_ms=latency_ms,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                estimated_cost_usd=cost,
                request_type=rtype.value,
                request_id=request_id,
                extra={"finish_reason": _finish_reason(data)},
            )
            self._emit_usage(on_usage, result)
            logger.info(
                "[ai] completion model=%s type=%s in=%s out=%s latency=%dms cost=$%.6f",
                effective_model,
                rtype.value,
                prompt_tokens,
                completion_tokens,
                latency_ms,
                cost,
            )
            return result

        self._emit_failure(on_usage, effective_model, rtype, started, request_id)
        if isinstance(last_error, AIProviderError):
            raise last_error
        raise AIProviderError("The AI service did not respond in time.")

    # --------------------------------------------------------------- stream

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
        payload = self._payload(
            messages,
            json_mode=False,
            max_tokens=max_tokens_for(rtype, self.settings, max_tokens),
            temperature=temperature if temperature is not None else temperature_for(rtype, self.settings),
        )
        payload["generationConfig"]["maxOutputTokens"] = payload["generationConfig"]["maxOutputTokens"]
        request_id = str(uuid.uuid4())
        started = time.monotonic()
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        output_chars = 0
        attempts = 0
        url = f"{self._base}/models/{effective_model}:streamGenerateContent?alt=sse"

        while attempts <= self.settings.ai_max_retries:
            attempts += 1
            yielded_any = False
            try:
                async with self._semaphore:
                    async with client.stream("POST", url, headers=self._headers(), json=payload) as response:
                        if response.status_code >= 400:
                            body = await response.aread()
                            raise classify_error(
                                response.status_code, error_detail_bytes(body), effective_model
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
                            piece = _extract_text(event)
                            if piece:
                                output_chars += len(piece)
                                yielded_any = True
                                yield piece
                            chunk_prompt, chunk_completion = _usage_of(event)
                            prompt_tokens = chunk_prompt or prompt_tokens
                            completion_tokens = chunk_completion or completion_tokens
                break
            except (httpx.HTTPError, AIProviderError) as exc:
                retryable = isinstance(exc, httpx.HTTPError) or not getattr(exc, "terminal", False)
                if yielded_any or not retryable or attempts > self.settings.ai_max_retries:
                    self._emit_failure(on_usage, effective_model, rtype, started, request_id)
                    if isinstance(exc, AIProviderError):
                        raise
                    raise AIProviderError("The AI stream was interrupted.") from exc
                logger.warning("[ai] stream retry %d/%d: %s", attempts, self.settings.ai_max_retries, exc)
                await asyncio.sleep(min(10.0, 2.0 * attempts) + random.uniform(0, 0.75))

        latency_ms = int((time.monotonic() - started) * 1000)
        cost = estimate_cost_usd(
            self.settings,
            model=effective_model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )
        if on_usage:
            on_usage(
                UsageEvent(
                    model=effective_model,
                    request_type=rtype.value,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    latency_ms=latency_ms,
                    estimated_cost_usd=cost,
                    request_id=request_id,
                    success=True,
                )
            )
        logger.info(
            "[ai] stream model=%s type=%s in=%s out=%s latency=%dms cost=$%.6f",
            effective_model,
            rtype.value,
            prompt_tokens,
            completion_tokens,
            latency_ms,
            cost,
        )

    # ---------------------------------------------------------------- usage

    @staticmethod
    def _emit_usage(callback: UsageCallback | None, result: CompletionResult) -> None:
        if not callback:
            return
        callback(
            UsageEvent(
                model=result.model,
                request_type=result.request_type,
                prompt_tokens=result.prompt_tokens,
                completion_tokens=result.completion_tokens,
                latency_ms=result.latency_ms,
                estimated_cost_usd=result.estimated_cost_usd,
                request_id=result.request_id,
                success=True,
            )
        )

    @staticmethod
    def _emit_failure(
        callback: UsageCallback | None,
        model: str,
        request_type: AIRequestType,
        started: float,
        request_id: str,
    ) -> None:
        if not callback:
            return
        callback(
            UsageEvent(
                model=model,
                request_type=request_type.value,
                prompt_tokens=None,
                completion_tokens=None,
                latency_ms=int((time.monotonic() - started) * 1000),
                estimated_cost_usd=0.0,
                request_id=request_id,
                success=False,
            )
        )
