"""Storage abstraction.

Production uses :class:`~app.services.store.supabase_store.SupabaseStore`
(Postgres as the authoritative datastore). Development/tests use
:class:`~app.services.store.memory_store.MemoryStore`.

The canonical video bundle (transcript + chunks + analysis) is shared across
users; user state (quota, usage, subscriptions, chat) is keyed by user id.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

VideoBundle = dict[str, Any]


class Store(ABC):
    """Persistence interface used by the API and services."""

    # ------------------------------------------------------------- lifecycle
    async def aclose(self) -> None:  # pragma: no cover - optional
        return None

    # ---------------------------------------------------------------- users
    @abstractmethod
    async def ensure_user(self, user_id: str, email: str | None = None) -> dict[str, Any]:
        ...

    @abstractmethod
    async def get_user(self, user_id: str) -> dict[str, Any] | None:
        ...

    @abstractmethod
    async def update_user(self, user_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        ...

    # --------------------------------------------------------------- devices
    @abstractmethod
    async def link_device(self, install_id: str, user_id: str | None) -> None:
        ...

    # ----------------------------------------------------------- canonical
    @abstractmethod
    async def load_video(self, video_id: str) -> VideoBundle | None:
        ...

    @abstractmethod
    async def save_video(
        self,
        video_id: str,
        *,
        status: str | None = None,
        metadata: dict[str, Any] | None = None,
        transcript: dict[str, Any] | None = None,
        chunks: list[dict[str, Any]] | None = None,
        analysis: dict[str, Any] | None = None,
    ) -> None:
        ...

    # ----------------------------------------------------------- ai usage
    @abstractmethod
    async def save_ai_usage(self, record: dict[str, Any]) -> None:
        ...

    # --------------------------------------------------------------- quota
    @abstractmethod
    async def get_used_videos(self, user_id: str) -> set[str]:
        ...

    @abstractmethod
    async def add_used_video(self, user_id: str, video_id: str) -> None:
        ...

    @abstractmethod
    async def get_period_usage(self, user_id: str, period: str) -> dict[str, Any]:
        ...

    @abstractmethod
    async def increment_period_usage(
        self,
        user_id: str,
        period: str,
        *,
        videos: int = 0,
        chat_messages: int = 0,
        ai_cost_usd: float = 0.0,
    ) -> dict[str, Any]:
        ...

    # -------------------------------------------------------- subscriptions
    @abstractmethod
    async def get_subscription(self, user_id: str) -> dict[str, Any] | None:
        ...

    @abstractmethod
    async def upsert_subscription(self, user_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        ...

    # --------------------------------------------------------------- chat
    @abstractmethod
    async def append_chat_message(
        self,
        user_id: str,
        video_id: str,
        *,
        role: str,
        content: str,
        citations: list[dict[str, Any]] | None = None,
        model: str | None = None,
    ) -> None:
        ...

    @abstractmethod
    async def list_chat_messages(
        self, user_id: str, video_id: str, limit: int = 200
    ) -> list[dict[str, Any]]:
        ...

    @abstractmethod
    async def clear_chat(self, user_id: str, video_id: str) -> None:
        ...

    # ----------------------------------------------------------- webhooks
    @abstractmethod
    async def mark_webhook_processed(
        self, event_id: str, provider: str, event_type: str | None
    ) -> bool:
        """Return True the first time an event is seen, False on a duplicate."""
        ...
