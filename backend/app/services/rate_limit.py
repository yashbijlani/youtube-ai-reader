"""In-memory rate limiting (sliding window per client IP)."""

from __future__ import annotations

import time
from collections import defaultdict, deque

from app.errors import RateLimited


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def check(self, bucket: str, limit: int, window_seconds: float) -> None:
        if limit <= 0:
            return
        key = bucket
        now = time.monotonic()
        events = self._events[key]
        cutoff = now - window_seconds
        while events and events[0] < cutoff:
            events.popleft()
        if len(events) >= limit:
            retry_after = int(window_seconds - (now - events[0])) + 1
            raise RateLimited(
                f"Too many requests. Try again in about {max(1, retry_after)} seconds."
            )
        events.append(now)

    def prune(self) -> None:
        cutoff = time.monotonic() - 3600
        empty: list[str] = []
        for key, events in self._events.items():
            while events and events[0] < cutoff:
                events.popleft()
            if not events:
                empty.append(key)
        for key in empty:
            del self._events[key]


limiter = SlidingWindowLimiter()
