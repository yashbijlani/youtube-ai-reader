"""Server-side quota enforcement.

Entitlement is decided from the database (subscription status), never from the
client. Video and chat consumption are atomic per user (see the Postgres
functions in ``supabase/migrations/0002_quota_functions.sql``).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.config import Settings
from app.errors import QuotaExceeded
from app.services.store.base import Store

logger = logging.getLogger("youtube_ai_reader.quota")


@dataclass
class QuotaDecision:
    allowed: bool
    reason: str
    used: int = 0
    remaining: int = 0
    limit: int = -1


class QuotaService:
    def __init__(self, settings: Settings, store: Store) -> None:
        self.settings = settings
        self.store = store

    async def reserve_video(self, user_id: str, video_id: str, period: str) -> QuotaDecision:
        """Reserve one video for this user; raise if the free quota is exhausted."""
        if not self.settings.quota_enabled:
            return QuotaDecision(True, "disabled")
        decision = await self.store.consume_video_quota(
            user_id,
            video_id,
            lifetime_limit=self.settings.free_video_limit,
            monthly_limit=self.settings.free_monthly_video_limit,
            period=period,
        )
        result = QuotaDecision(
            allowed=bool(decision.get("allowed")),
            reason=str(decision.get("reason") or "unknown"),
            used=int(decision.get("used") or 0),
            remaining=int(decision.get("remaining") or 0),
            limit=int(decision.get("limit") if decision.get("limit") is not None else -1),
        )
        if not result.allowed:
            logger.info(
                "[quota] video denied user=%s video=%s reason=%s used=%s",
                user_id[:8],
                video_id,
                result.reason,
                result.used,
            )
            if result.reason == "monthly_limit":
                raise QuotaExceeded(
                    f"You've used all {self.settings.free_monthly_video_limit} free videos this month. "
                    "Upgrade to Pro for unlimited reading."
                )
            raise QuotaExceeded(
                f"You've used all {self.settings.free_video_limit} free videos. "
                "Upgrade to Pro for unlimited reading."
            )
        return result

    async def reserve_chat(self, user_id: str, period: str) -> QuotaDecision:
        if not self.settings.quota_enabled:
            return QuotaDecision(True, "disabled")
        decision = await self.store.consume_chat_quota(
            user_id, monthly_limit=self.settings.free_monthly_chat_limit, period=period
        )
        result = QuotaDecision(
            allowed=bool(decision.get("allowed")),
            reason=str(decision.get("reason") or "unknown"),
            used=int(decision.get("used") or 0),
            remaining=int(decision.get("remaining") or 0),
            limit=int(decision.get("limit") if decision.get("limit") is not None else -1),
        )
        if not result.allowed:
            raise QuotaExceeded(
                f"You've used all {self.settings.free_monthly_chat_limit} free chat messages this month. "
                "Upgrade to Pro for unlimited chat."
            )
        return result
