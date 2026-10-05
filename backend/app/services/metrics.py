"""Simple in-process metrics for observability and future cost accounting."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field


@dataclass
class Metrics:
    videos_processed: int = 0
    cache_hits: int = 0
    ai_calls: int = 0
    ai_errors: int = 0
    ai_input_chars: int = 0
    ai_output_chars: int = 0
    ai_input_tokens: int = 0
    ai_output_tokens: int = 0
    ai_cost_usd: float = 0.0
    chat_requests: int = 0
    chat_input_chars: int = 0
    chat_output_chars: int = 0
    by_model: dict[str, int] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def record_ai_usage(self, record: object) -> None:
        """Accumulate authoritative token/cost usage (duck-typed record)."""
        with self._lock:
            if not getattr(record, "success", True):
                self.ai_errors += 1
                return
            input_tokens = getattr(record, "input_tokens", None) or 0
            output_tokens = getattr(record, "output_tokens", None) or 0
            self.ai_input_tokens += input_tokens
            self.ai_output_tokens += output_tokens
            self.ai_cost_usd = round(
                self.ai_cost_usd + (getattr(record, "estimated_cost_usd", 0.0) or 0.0), 8
            )
            model = getattr(record, "model", "unknown")
            self.by_model[model] = self.by_model.get(model, 0) + 1

    def record_ai_call(
        self, model: str, input_chars: int, output_chars: int, *, error: bool = False
    ) -> None:
        with self._lock:
            if error:
                self.ai_errors += 1
                return
            self.ai_calls += 1
            self.ai_input_chars += input_chars
            self.ai_output_chars += output_chars
            self.by_model[model] = self.by_model.get(model, 0) + 1

    def record_video(self, *, cached: bool) -> None:
        with self._lock:
            self.videos_processed += 1
            if cached:
                self.cache_hits += 1

    def record_chat(self, input_chars: int, output_chars: int) -> None:
        with self._lock:
            self.chat_requests += 1
            self.chat_input_chars += input_chars
            self.chat_output_chars += output_chars

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "videos_processed": self.videos_processed,
                "cache_hits": self.cache_hits,
                "ai_calls": self.ai_calls,
                "ai_errors": self.ai_errors,
                "ai_input_chars": self.ai_input_chars,
                "ai_output_chars": self.ai_output_chars,
                "ai_input_tokens": self.ai_input_tokens,
                "ai_output_tokens": self.ai_output_tokens,
                "ai_cost_usd": self.ai_cost_usd,
                "chat_requests": self.chat_requests,
                "chat_input_chars": self.chat_input_chars,
                "chat_output_chars": self.chat_output_chars,
                "by_model": dict(self.by_model),
            }


metrics = Metrics()
