"""Provider-agnostic AI types and helpers.

The rest of the app talks to ``AIProvider`` only. Concrete providers
(``GeminiProvider`` in production, ``OpenAICompatibleProvider`` for local
development) live alongside this module.
"""

from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any

from app.errors import (
    AIAccessDenied,
    AIFundingError,
    AIModelUnavailable,
    AIProviderError,
)
from app.services.ai.routing import AIRequestType


@dataclass
class CompletionResult:
    text: str
    model: str
    input_chars: int = 0
    output_chars: int = 0
    latency_ms: int = 0
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    estimated_cost_usd: float = 0.0
    request_type: str | None = None
    request_id: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class UsageEvent:
    """Authoritative usage for one provider call (streamed or not)."""

    model: str
    request_type: str | None
    prompt_tokens: int | None
    completion_tokens: int | None
    latency_ms: int
    estimated_cost_usd: float
    request_id: str | None = None
    success: bool = True


UsageCallback = Callable[[UsageEvent], None]


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
        request_type: AIRequestType | None = None,
        on_usage: UsageCallback | None = None,
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
        request_type: AIRequestType | None = None,
        on_usage: UsageCallback | None = None,
    ) -> AsyncIterator[str]:
        ...

    async def aclose(self) -> None:  # pragma: no cover - trivial
        return None

    async def preflight(self) -> None:
        """Cheap check that the provider is usable; default no-op."""
        return None


# ------------------------------------------------------------------ errors


def classify_error(status: int, detail: str, model: str) -> AIProviderError:
    """Map an HTTP status to a typed, terminal-aware provider error."""
    lowered = (detail or "").lower()
    if status == 401:
        return AIAccessDenied()
    if status == 402:
        return AIFundingError()
    if status == 403:
        return AIAccessDenied()
    if status == 404:
        return AIModelUnavailable(model)
    if status == 400:
        if "api key not valid" in lowered or "api_key_invalid" in lowered:
            return AIAccessDenied()
        # Some providers (e.g. DeepSeek) report an unknown model as HTTP 400.
        if "model" in lowered and any(
            marker in lowered
            for marker in (
                "not exist",
                "does not exist",
                "supported api model names",
                "invalid model",
                "unknown model",
                "model not found",
            )
        ):
            return AIModelUnavailable(model)
    if status in (408, 429):
        return AIProviderError(f"The AI service is busy (HTTP {status}).")
    if status >= 500:
        return AIProviderError(f"The AI service failed (HTTP {status}): {detail}")
    return AIProviderError(f"AI request failed (HTTP {status}): {detail}")


def extract_error_message(data: Any) -> str | None:
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])
        if isinstance(error, str):
            return error
        if data.get("message"):
            return str(data["message"])
    if isinstance(data, list) and data:
        return extract_error_message(data[0])
    return None


def error_detail(response: Any) -> str:
    try:
        message = extract_error_message(response.json())
        if message:
            return message[:300]
        return response.text[:300]
    except ValueError:
        return (getattr(response, "text", "") or "empty response")[:300]


def error_detail_bytes(body: bytes) -> str:
    try:
        message = extract_error_message(json.loads(body))
        if message:
            return message[:300]
        return body.decode("utf-8", errors="replace")[:300]
    except (ValueError, TypeError):
        return body.decode("utf-8", errors="replace")[:300]


# ------------------------------------------------------------------ JSON


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)


def extract_json(text: str) -> dict[str, Any]:
    """Pull a JSON object out of a model response, tolerating fences/preamble."""
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
