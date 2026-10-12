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
    plan: str = "free"


@dataclass
class QuotaReservation:
    """A reserved video slot, refundable if the job fails before a transcript."""

    user_id: str
    video_id: str
    period: str
    plan: str
    charged: bool
    max_video_minutes: int


class QuotaService:
    def __init__(self, settings: Settings, store: Store) -> None:
        self.settings = settings
        self.store = store

    def monthly_video_limit(self, plan: str) -> int:
        return (
            self.settings.pro_monthly_video_limit
            if plan == "pro"
            else self.settings.free_monthly_video_limit
        )

    def max_video_minutes(self, plan: str) -> int:
        return (
            self.settings.pro_max_video_minutes
            if plan == "pro"
            else self.settings.free_max_video_minutes
        )

    async def reserve_video(self, user_id: str, video_id: str, period: str) -> QuotaDecision:
        """Reserve one video for this user; raise if the monthly quota is exhausted."""
        if not self.settings.quota_enabled:
            return QuotaDecision(True, "disabled")
        # The atomic RPC locks the user's profile row; if it is missing the RPC
        # reports `user_missing` and we would wrongly block a user who still has
        # quota. Make sure the row exists first.
        await self.store.ensure_user(user_id)
        decision = await self.store.consume_video_quota(
            user_id,
            video_id,
            free_monthly_limit=self.settings.free_monthly_video_limit,
            pro_monthly_limit=self.settings.pro_monthly_video_limit,
            period=period,
        )
        result = QuotaDecision(
            allowed=bool(decision.get("allowed")),
            reason=str(decision.get("reason") or "unknown"),
            used=int(decision.get("used") or 0),
            remaining=int(decision.get("remaining") or 0),
            limit=int(decision.get("limit") if decision.get("limit") is not None else -1),
            plan=str(decision.get("plan") or "free"),
        )
        if not result.allowed:
            logger.info(
                "[quota] video denied user=%s video=%s reason=%s used=%s plan=%s",
                user_id[:8],
                video_id,
                result.reason,
                result.used,
                result.plan,
            )
            if result.reason == "user_missing":
                # Defensive: a missing profile must never consume the paywall.
                logger.warning("[quota] profile missing after ensure; allowing user=%s", user_id[:8])
                return QuotaDecision(True, "user_missing", result.used, result.remaining, result.limit, result.plan)
            limit = result.limit if result.limit > 0 else self.monthly_video_limit(result.plan)
            if result.plan == "pro":
                raise QuotaExceeded(
                    f"You've used all {limit} videos this month on Pro. "
                    "Your limit resets at the start of your next billing cycle."
                )
            raise QuotaExceeded(
                f"You've used all {limit} free videos this month. Upgrade to Pro for 50 videos a month."
            )
        return result

    async def release_video(self, user_id: str, video_id: str, period: str) -> bool:
        """Refund a reservation after a failed job (best-effort)."""
        try:
            return await self.store.release_video_quota(user_id, video_id, period)
        except Exception:  # noqa: BLE001 - refund must never break error handling
            logger.warning("[quota] release failed user=%s video=%s", user_id[:8], video_id, exc_info=True)
            return False

    async def reserve_chat(self, user_id: str, period: str) -> QuotaDecision:
        if not self.settings.quota_enabled:
            return QuotaDecision(True, "disabled")
        # See reserve_video: guarantee the profile row exists before the RPC.
        await self.store.ensure_user(user_id)
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
            if result.reason == "user_missing":
                logger.warning("[quota] profile missing after ensure; allowing user=%s", user_id[:8])
                return QuotaDecision(True, "user_missing", result.used, result.remaining, result.limit)
            raise QuotaExceeded(
                f"You've used all {self.settings.free_monthly_chat_limit} free chat messages this month. "
                "Upgrade to Pro for unlimited chat."
            )
        return result
