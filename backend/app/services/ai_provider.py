"""Backwards-compatible import surface for AI providers.

New code should import from :mod:`app.services.ai`. This module is kept so
existing imports and tests continue to work.
"""

from __future__ import annotations

from app.services.ai import (
    AIProvider,
    AIRequestType,
    CompletionResult,
    GeminiProvider,
    ModelTier,
    OpenAICompatibleProvider,
    UsageCallback,
    UsageEvent,
    classify_error,
    extract_json,
    route_model,
)
from app.services.ai.base import (
    classify_error as _classify_error,
)
from app.services.ai.base import (
    error_detail,
    error_detail_bytes,
    extract_error_message,
)

OpenCodeAIProvider = OpenAICompatibleProvider

__all__ = [
    "AIProvider",
    "AIRequestType",
    "CompletionResult",
    "GeminiProvider",
    "ModelTier",
    "OpenAICompatibleProvider",
    "OpenCodeAIProvider",
    "UsageCallback",
    "UsageEvent",
    "_classify_error",
    "classify_error",
    "error_detail",
    "error_detail_bytes",
    "extract_error_message",
    "extract_json",
    "route_model",
]
