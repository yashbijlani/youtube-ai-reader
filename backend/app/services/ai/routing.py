"""Centralized AI request routing, generation limits, and cost estimation.

One place decides which model serves a request, how it is generated, and what
it costs. Callers pass an ``AIRequestType``; nothing else hardcodes model names.
"""

from __future__ import annotations

from enum import Enum

from app.config import Settings


class AIRequestType(str, Enum):
    """Every distinct kind of model work the product performs."""

    PREFLIGHT = "preflight"
    CLASSIFICATION = "classification"
    SUMMARY = "summary"
    ANALYSIS = "analysis"  # overview + key points + chapters
    GUIDE = "guide"  # article-style detailed reading
    CHAT_SIMPLE = "chat_simple"
    CHAT_COMPLEX = "chat_complex"


class ModelTier(str, Enum):
    FAST = "fast"
    MAIN = "main"


#: Which tier serves each request type. Cost-sensitive work goes to FAST.
TIER_BY_REQUEST: dict[AIRequestType, ModelTier] = {
    AIRequestType.PREFLIGHT: ModelTier.FAST,
    AIRequestType.CLASSIFICATION: ModelTier.FAST,
    AIRequestType.SUMMARY: ModelTier.FAST,
    AIRequestType.ANALYSIS: ModelTier.FAST,
    AIRequestType.GUIDE: ModelTier.MAIN,
    AIRequestType.CHAT_SIMPLE: ModelTier.FAST,
    AIRequestType.CHAT_COMPLEX: ModelTier.MAIN,
}

#: Default output budget (tokens) per request type.
MAX_TOKENS_BY_REQUEST: dict[AIRequestType, int] = {
    AIRequestType.PREFLIGHT: 8,
    AIRequestType.CLASSIFICATION: 256,
    AIRequestType.SUMMARY: 2_500,
    AIRequestType.ANALYSIS: 6_000,
    AIRequestType.GUIDE: 6_000,
    AIRequestType.CHAT_SIMPLE: 2_000,
    AIRequestType.CHAT_COMPLEX: 4_000,
}


def route_model(request_type: AIRequestType, settings: Settings) -> str:
    """Return the configured model id for a request type."""
    if TIER_BY_REQUEST.get(request_type, ModelTier.MAIN) == ModelTier.FAST:
        return settings.effective_fast_model
    return settings.gemini_model_main


def temperature_for(request_type: AIRequestType, settings: Settings) -> float:
    """Slightly cooler for factual/structured work, default otherwise."""
    if request_type in (AIRequestType.CHAT_COMPLEX, AIRequestType.CHAT_SIMPLE):
        return min(0.4, settings.ai_temperature)
    return settings.ai_temperature


def max_tokens_for(request_type: AIRequestType, settings: Settings, override: int | None = None) -> int:
    if override:
        return override
    return min(
        MAX_TOKENS_BY_REQUEST.get(request_type, settings.ai_max_output_tokens),
        settings.ai_hard_max_output_tokens,
    )


def estimate_cost_usd(
    settings: Settings,
    *,
    model: str,
    prompt_tokens: int | None,
    completion_tokens: int | None,
) -> float:
    """Estimate USD cost from authoritative token counts when available."""
    if not prompt_tokens and not completion_tokens:
        return 0.0
    is_main = model == settings.gemini_model_main
    price_in = settings.ai_price_main_input if is_main else settings.ai_price_fast_input
    price_out = settings.ai_price_main_output if is_main else settings.ai_price_fast_output
    cost = (prompt_tokens or 0) / 1_000_000 * price_in
    cost += (completion_tokens or 0) / 1_000_000 * price_out
    return round(cost, 8)
