"""In-memory store for development and tests."""

from __future__ import annotations

import asyncio
import copy
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from app.services.store.base import Store, VideoBundle


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class MemoryStore(Store):
    def __init__(self) -> None:
        self.users: dict[str, dict[str, Any]] = {}
        self.devices: dict[str, str | None] = {}
        self.videos: dict[str, VideoBundle] = {}
        self.ai_usage: list[dict[str, Any]] = []
        self.used_videos: dict[str, set[str]] = defaultdict(set)
        self.periods: dict[tuple[str, str], dict[str, Any]] = {}
        self.subscriptions: dict[str, dict[str, Any]] = {}
        self.chat: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        self.webhooks: set[str] = set()
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    def _lock(self, user_id: str) -> asyncio.Lock:
        return self._locks[user_id]

    async def ensure_user(self, user_id: str, email: str | None = None) -> dict[str, Any]:
        user = self.users.get(user_id)
        if user is None:
            user = {"id": user_id, "email": email, "plan": "free", "created_at": _now(), "updated_at": _now()}
            self.users[user_id] = user
        elif email and not user.get("email"):
            user["email"] = email
        return copy.deepcopy(user)

    async def get_user(self, user_id: str) -> dict[str, Any] | None:
        user = self.users.get(user_id)
        return copy.deepcopy(user) if user else None

    async def update_user(self, user_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        user = self.users.get(user_id)
        if user is None:
            return None
        user.update(fields)
        user["updated_at"] = _now()
        return copy.deepcopy(user)

    async def link_device(self, install_id: str, user_id: str | None) -> None:
        self.devices[install_id] = user_id

    async def load_video(self, video_id: str) -> VideoBundle | None:
        bundle = self.videos.get(video_id)
        return copy.deepcopy(bundle) if bundle else None

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
        bundle = self.videos.setdefault(video_id, {})
        if status:
            bundle["status"] = status
        if metadata is not None:
            bundle["metadata"] = copy.deepcopy(metadata)
        if transcript is not None:
            bundle["transcript"] = copy.deepcopy(transcript)
        if chunks is not None:
            bundle["chunks"] = copy.deepcopy(chunks)
        if analysis is not None:
            bundle["analysis"] = copy.deepcopy(analysis)

    async def save_ai_usage(self, record: dict[str, Any]) -> None:
        self.ai_usage.append(copy.deepcopy(record))

    async def get_used_videos(self, user_id: str) -> set[str]:
        return set(self.used_videos.get(user_id, set()))

    async def add_used_video(self, user_id: str, video_id: str) -> None:
        self.used_videos[user_id].add(video_id)

    async def get_period_usage(self, user_id: str, period: str) -> dict[str, Any]:
        return copy.deepcopy(
            self.periods.get((user_id, period), {"videos_used": 0, "chat_messages": 0, "ai_cost_usd": 0.0})
        )

    async def increment_period_usage(
        self,
        user_id: str,
        period: str,
        *,
        videos: int = 0,
        chat_messages: int = 0,
        ai_cost_usd: float = 0.0,
    ) -> dict[str, Any]:
        row = self.periods.setdefault(
            (user_id, period), {"videos_used": 0, "chat_messages": 0, "ai_cost_usd": 0.0}
        )
        row["videos_used"] += videos
        row["chat_messages"] += chat_messages
        row["ai_cost_usd"] = round(row["ai_cost_usd"] + ai_cost_usd, 8)
        row["updated_at"] = _now()
        return copy.deepcopy(row)

    def _is_pro(self, user_id: str) -> bool:
        return self.subscriptions.get(user_id, {}).get("status") == "ACTIVE"

    async def consume_video_quota(
        self,
        user_id: str,
        video_id: str,
        *,
        free_monthly_limit: int,
        pro_monthly_limit: int,
        period: str,
    ) -> dict[str, Any]:
        async with self._lock(user_id):
            pro = self._is_pro(user_id)
            plan = "pro" if pro else "free"
            limit = pro_monthly_limit if pro else free_monthly_limit
            if not self.users.get(user_id):
                self.users[user_id] = {"id": user_id, "plan": "free", "created_at": _now(), "updated_at": _now()}
            used = self.used_videos[user_id]
            period_row = self.periods.setdefault(
                (user_id, period), {"videos_used": 0, "chat_messages": 0, "ai_cost_usd": 0.0}
            )
            month = period_row["videos_used"]
            if video_id in used:
                return {
                    "allowed": True,
                    "reason": "already_used",
                    "used": month,
                    "remaining": max(limit - month, 0),
                    "limit": limit,
                    "plan": plan,
                }
            if month >= limit:
                return {
                    "allowed": False,
                    "reason": "monthly_limit",
                    "used": month,
                    "remaining": 0,
                    "limit": limit,
                    "plan": plan,
                }
            used.add(video_id)
            period_row["videos_used"] += 1
            period_row["updated_at"] = _now()
            return {
                "allowed": True,
                "reason": "ok",
                "used": month + 1,
                "remaining": max(limit - (month + 1), 0),
                "limit": limit,
                "plan": plan,
            }

    async def release_video_quota(self, user_id: str, video_id: str, period: str) -> bool:
        async with self._lock(user_id):
            used = self.used_videos.get(user_id)
            if not used or video_id not in used:
                return False
            used.discard(video_id)
            row = self.periods.get((user_id, period))
            if row is not None:
                row["videos_used"] = max(int(row.get("videos_used", 0)) - 1, 0)
                row["updated_at"] = _now()
            return True

    async def consume_chat_quota(
        self, user_id: str, *, monthly_limit: int, period: str
    ) -> dict[str, Any]:
        async with self._lock(user_id):
            if self._is_pro(user_id):
                return {"allowed": True, "reason": "pro", "used": 0, "remaining": -1, "limit": -1}
            period_row = self.periods.setdefault(
                (user_id, period), {"videos_used": 0, "chat_messages": 0, "ai_cost_usd": 0.0}
            )
            if period_row["chat_messages"] >= monthly_limit:
                return {"allowed": False, "reason": "chat_limit", "used": period_row["chat_messages"], "remaining": 0, "limit": monthly_limit}
            period_row["chat_messages"] += 1
            period_row["updated_at"] = _now()
            return {
                "allowed": True,
                "reason": "ok",
                "used": period_row["chat_messages"],
                "remaining": max(monthly_limit - period_row["chat_messages"], 0),
                "limit": monthly_limit,
            }

    async def get_subscription(self, user_id: str) -> dict[str, Any] | None:
        row = self.subscriptions.get(user_id)
        return copy.deepcopy(row) if row else None

    async def upsert_subscription(self, user_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        row = self.subscriptions.setdefault(
            user_id, {"user_id": user_id, "provider": "razorpay", "status": "FREE", "plan": "pro"}
        )
        row.update(fields)
        row["updated_at"] = _now()
        return copy.deepcopy(row)

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
        self.chat[(user_id, video_id)].append(
            {
                "role": role,
                "content": content,
                "citations": citations or [],
                "model": model,
                "created_at": _now(),
            }
        )

    async def list_chat_messages(
        self, user_id: str, video_id: str, limit: int = 200
    ) -> list[dict[str, Any]]:
        return copy.deepcopy(self.chat.get((user_id, video_id), [])[-limit:])

    async def clear_chat(self, user_id: str, video_id: str) -> None:
        self.chat.pop((user_id, video_id), None)

    async def mark_webhook_processed(
        self, event_id: str, provider: str, event_type: str | None
    ) -> bool:
        if event_id in self.webhooks:
            return False
        self.webhooks.add(event_id)
        return True
