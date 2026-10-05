"""Supabase/Postgres backed store — the authoritative production datastore."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.services.store.base import Store, VideoBundle
from app.services.store.supabase_client import SupabaseClient, SupabaseError

logger = logging.getLogger("youtube_ai_reader.store.supabase")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SupabaseStore(Store):
    def __init__(self, client: SupabaseClient) -> None:
        self.client = client

    async def aclose(self) -> None:
        await self.client.aclose()

    async def _single(self, table: str, **kwargs: Any) -> dict[str, Any] | None:
        try:
            return await self.client.select(table, single=True, **kwargs)
        except SupabaseError as exc:
            if exc.status in (406, 404):
                return None
            raise

    # ---------------------------------------------------------------- users
    async def ensure_user(self, user_id: str, email: str | None = None) -> dict[str, Any]:
        existing = await self._single("users", filters=[("id", "eq", user_id)])
        if existing:
            if email and not existing.get("email"):
                return (await self.client.update("users", {"email": email}, filters=[("id", "eq", user_id)]))[0]
            return existing
        rows = await self.client.insert(
            "users", {"id": user_id, "email": email}, upsert=True, on_conflict="id"
        )
        return rows[0]

    async def get_user(self, user_id: str) -> dict[str, Any] | None:
        return await self._single("users", filters=[("id", "eq", user_id)])

    async def update_user(self, user_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        rows = await self.client.update("users", fields, filters=[("id", "eq", user_id)])
        return rows[0] if rows else None

    # --------------------------------------------------------------- devices
    async def link_device(self, install_id: str, user_id: str | None) -> None:
        await self.client.insert(
            "devices",
            {"install_id": install_id, "user_id": user_id, "last_seen_at": _now()},
            upsert=True,
            on_conflict="install_id",
        )

    # ----------------------------------------------------------- canonical
    async def load_video(self, video_id: str) -> VideoBundle | None:
        video = await self._single("videos", filters=[("id", "eq", video_id)])
        if not video:
            return None
        bundle: VideoBundle = {"status": video.get("status")}
        metadata = video.get("metadata") or {}
        bundle["metadata"] = {
            **metadata,
            "video_id": video_id,
            "title": video.get("title") or metadata.get("title") or "Untitled video",
            "channel": video.get("channel") or metadata.get("channel"),
            "duration": video.get("duration") if video.get("duration") is not None else metadata.get("duration"),
            "language": video.get("language") or metadata.get("language"),
            "thumbnail": video.get("thumbnail") or metadata.get("thumbnail"),
        }
        transcript = await self._single("transcripts", filters=[("video_id", "eq", video_id)])
        if transcript:
            bundle["transcript"] = {
                "video_id": video_id,
                "language": transcript.get("language"),
                "kind": transcript.get("kind") or "none",
                "segments": transcript.get("segments") or [],
            }
            bundle["transcript_source"] = {"source": transcript.get("source"), "verified": False}
        # Chunks are recomputed in memory from the transcript; not persisted.
        analysis = await self._single("video_analysis", filters=[("video_id", "eq", video_id)])
        if analysis:
            bundle["analysis"] = {
                "overview": analysis.get("overview") or "",
                "key_points": analysis.get("key_points") or [],
                "chapters": analysis.get("chapters") or [],
                "detailed_reading": analysis.get("detailed_reading") or "",
                "generated_by": analysis.get("model"),
                "prompt_version": analysis.get("prompt_version"),
                "degraded": bool(analysis.get("degraded")),
                "degraded_reason": analysis.get("degraded_reason"),
            }
            bundle["analysis_quick_read"] = {"quick_read": analysis.get("quick_read") or ""}
        return bundle

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
        if status or metadata:
            row: dict[str, Any] = {"id": video_id}
            if status:
                row["status"] = status
            if metadata:
                row.update(
                    {
                        "title": metadata.get("title"),
                        "channel": metadata.get("channel"),
                        "duration": metadata.get("duration"),
                        "language": metadata.get("language"),
                        "thumbnail": metadata.get("thumbnail"),
                        "metadata": metadata,
                    }
                )
            await self.client.insert("videos", row, upsert=True, on_conflict="id")

        if transcript is not None:
            segments = transcript.get("segments") or []
            await self.client.insert(
                "transcripts",
                {
                    "video_id": video_id,
                    "language": transcript.get("language"),
                    "kind": transcript.get("kind") or "none",
                    "source": transcript.get("source") or "server_ytdlp",
                    "segments": segments,
                    "char_count": sum(len(s.get("text", "")) for s in segments),
                    "updated_at": _now(),
                },
                upsert=True,
                on_conflict="video_id",
            )

        if chunks is not None:
            # Chunks are recomputed in memory from the transcript; not persisted.
            pass

        if analysis is not None:
            await self.client.insert(
                "video_analysis",
                {
                    "video_id": video_id,
                    "overview": analysis.get("overview") or "",
                    "key_points": analysis.get("key_points") or [],
                    "chapters": analysis.get("chapters") or [],
                    "detailed_reading": analysis.get("detailed_reading") or "",
                    "quick_read": analysis.get("quick_read") or "",
                    "model": analysis.get("generated_by") or analysis.get("model"),
                    "prompt_version": analysis.get("prompt_version"),
                    "degraded": bool(analysis.get("degraded")),
                    "degraded_reason": analysis.get("degraded_reason"),
                    "updated_at": _now(),
                },
                upsert=True,
                on_conflict="video_id",
            )
            await self.client.update(
                "videos",
                {
                    "status": "ready",
                    "model": analysis.get("generated_by") or analysis.get("model"),
                    "prompt_version": analysis.get("prompt_version"),
                    "processed_at": _now(),
                },
                filters=[("id", "eq", video_id)],
            )

    # ----------------------------------------------------------- ai usage
    async def save_ai_usage(self, record: dict[str, Any]) -> None:
        row = {
            key: record.get(key)
            for key in (
                "user_id",
                "video_id",
                "model",
                "request_type",
                "input_tokens",
                "output_tokens",
                "estimated_cost_usd",
                "latency_ms",
                "success",
                "request_id",
            )
        }
        if row["user_id"] == "anonymous":
            row["user_id"] = None
        await self.client.insert("ai_usage", row)

    # --------------------------------------------------------------- quota
    async def get_used_videos(self, user_id: str) -> set[str]:
        rows = await self.client.select(
            "used_videos", columns="video_id", filters=[("user_id", "eq", user_id)], params={"limit": "10000"}
        )
        return {row["video_id"] for row in rows}

    async def add_used_video(self, user_id: str, video_id: str) -> None:
        try:
            await self.client.insert(
                "used_videos",
                {"user_id": user_id, "video_id": video_id},
                upsert=True,
                on_conflict="user_id,video_id",
            )
        except SupabaseError as exc:
            if exc.status != 409:  # already recorded is fine
                raise

    async def get_period_usage(self, user_id: str, period: str) -> dict[str, Any]:
        row = await self._single(
            "usage_periods", filters=[("user_id", "eq", user_id), ("period", "eq", period)]
        )
        return row or {"videos_used": 0, "chat_messages": 0, "ai_cost_usd": 0.0}

    async def increment_period_usage(
        self,
        user_id: str,
        period: str,
        *,
        videos: int = 0,
        chat_messages: int = 0,
        ai_cost_usd: float = 0.0,
    ) -> dict[str, Any]:
        current = await self.get_period_usage(user_id, period)
        row = {
            "user_id": user_id,
            "period": period,
            "videos_used": int(current.get("videos_used", 0)) + videos,
            "chat_messages": int(current.get("chat_messages", 0)) + chat_messages,
            "ai_cost_usd": round(float(current.get("ai_cost_usd", 0.0)) + ai_cost_usd, 8),
            "updated_at": _now(),
        }
        rows = await self.client.insert(
            "usage_periods", row, upsert=True, on_conflict="user_id,period"
        )
        return rows[0] if rows else row

    async def consume_video_quota(
        self,
        user_id: str,
        video_id: str,
        *,
        lifetime_limit: int,
        monthly_limit: int,
        period: str,
    ) -> dict[str, Any]:
        result = await self.client.rpc(
            "consume_video_quota",
            {
                "p_user": user_id,
                "p_video": video_id,
                "p_lifetime_limit": lifetime_limit,
                "p_monthly_limit": monthly_limit,
                "p_period": period,
            },
        )
        row = result[0] if isinstance(result, list) and result else (result or {})
        return {
            "allowed": bool(row.get("allowed")),
            "reason": row.get("reason"),
            "used": int(row.get("used") or 0),
            "remaining": int(row.get("remaining") or 0),
            "limit": int(row.get("limit_value") if row.get("limit_value") is not None else -1),
        }

    async def consume_chat_quota(
        self, user_id: str, *, monthly_limit: int, period: str
    ) -> dict[str, Any]:
        result = await self.client.rpc(
            "consume_chat_quota",
            {"p_user": user_id, "p_monthly_limit": monthly_limit, "p_period": period},
        )
        row = result[0] if isinstance(result, list) and result else (result or {})
        return {
            "allowed": bool(row.get("allowed")),
            "reason": row.get("reason"),
            "used": int(row.get("used") or 0),
            "remaining": int(row.get("remaining") or 0),
            "limit": int(row.get("limit_value") if row.get("limit_value") is not None else -1),
        }

    # -------------------------------------------------------- subscriptions
    async def get_subscription(self, user_id: str) -> dict[str, Any] | None:
        return await self._single("subscriptions", filters=[("user_id", "eq", user_id)])

    async def upsert_subscription(self, user_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        row = {"user_id": user_id, **fields, "updated_at": _now()}
        rows = await self.client.insert(
            "subscriptions", row, upsert=True, on_conflict="user_id"
        )
        return rows[0] if rows else row

    # --------------------------------------------------------------- chat
    async def _ensure_session(self, user_id: str, video_id: str) -> str:
        rows = await self.client.insert(
            "chat_sessions",
            {"user_id": user_id, "video_id": video_id, "updated_at": _now()},
            upsert=True,
            on_conflict="user_id,video_id",
        )
        return rows[0]["id"]

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
        session_id = await self._ensure_session(user_id, video_id)
        await self.client.insert(
            "chat_messages",
            {
                "session_id": session_id,
                "role": role,
                "content": content,
                "citations": citations or [],
                "model": model,
            },
        )

    async def list_chat_messages(
        self, user_id: str, video_id: str, limit: int = 200
    ) -> list[dict[str, Any]]:
        session = await self._single(
            "chat_sessions", filters=[("user_id", "eq", user_id), ("video_id", "eq", video_id)]
        )
        if not session:
            return []
        return await self.client.select(
            "chat_messages",
            filters=[("session_id", "eq", session["id"])],
            params={"order": "created_at.asc", "limit": str(limit)},
        )

    async def clear_chat(self, user_id: str, video_id: str) -> None:
        session = await self._single(
            "chat_sessions", filters=[("user_id", "eq", user_id), ("video_id", "eq", video_id)]
        )
        if session:
            await self.client.delete("chat_sessions", filters=[("id", "eq", session["id"])])

    # ----------------------------------------------------------- webhooks
    async def mark_webhook_processed(
        self, event_id: str, provider: str, event_type: str | None
    ) -> bool:
        try:
            await self.client.insert(
                "webhook_events",
                {"id": event_id, "provider": provider, "event_type": event_type},
                upsert=False,
            )
            return True
        except SupabaseError as exc:
            if exc.status == 409:
                return False
            raise
