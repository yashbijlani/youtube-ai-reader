"""AI provider package.

Production: :class:`GeminiProvider` (direct Gemini REST API).
Development/local: :class:`OpenAICompatibleProvider` (Ollama, vLLM, …).

``app.services.ai_provider`` re-exports these for backwards compatibility.
"""

from app.services.ai.base import (
    AIProvider,
    CompletionResult,
    UsageCallback,
    UsageEvent,
    classify_error,
    extract_json,
)
from app.services.ai.gemini import GeminiProvider
from app.services.ai.openai_compat import OpenAICompatibleProvider
from app.services.ai.routing import AIRequestType, ModelTier, route_model


def create_provider(settings) -> AIProvider:  # noqa: ANN001 - Settings avoids cycle
    """Build the configured provider. Production is always Gemini."""
    if settings.ai_provider == "openai_compatible":
        return OpenAICompatibleProvider(settings)
    return GeminiProvider(settings)


__all__ = [
    "AIProvider",
    "AIRequestType",
    "CompletionResult",
    "GeminiProvider",
    "ModelTier",
    "OpenAICompatibleProvider",
    "UsageCallback",
    "UsageEvent",
    "classify_error",
    "create_provider",
    "extract_json",
    "route_model",
]
