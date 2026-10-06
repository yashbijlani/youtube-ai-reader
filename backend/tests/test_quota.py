"""Server-side quota tests (atomic consumption in MemoryStore)."""

from __future__ import annotations

import asyncio

import pytest

from app.config import Settings
from app.errors import QuotaExceeded
from app.services.quota import QuotaService
from app.services.store.memory_store import MemoryStore

PERIOD = "2026-10"


def _settings() -> Settings:
    settings = Settings(_env_file=None)
    settings.free_video_limit = 3
    settings.free_monthly_video_limit = 3
    settings.free_monthly_chat_limit = 2
    return settings


async def test_free_user_lifetime_limit() -> None:
    store = MemoryStore()
    quota = QuotaService(_settings(), store)
    for video in ("aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"):
        decision = await quota.reserve_video("u1", video, PERIOD)
        assert decision.allowed
    with pytest.raises(QuotaExceeded):
        await quota.reserve_video("u1", "ddddddddddd", PERIOD)
    assert len(store.used_videos["u1"]) == 3


async def test_same_video_does_not_count_twice() -> None:
    store = MemoryStore()
    quota = QuotaService(_settings(), store)
    await quota.reserve_video("u1", "aaaaaaaaaaa", PERIOD)
    await quota.reserve_video("u1", "aaaaaaaaaaa", PERIOD)
    assert len(store.used_videos["u1"]) == 1
    assert store.periods[("u1", PERIOD)]["videos_used"] == 1


async def test_monthly_limit_can_be_stricter_than_lifetime() -> None:
    settings = _settings()
    settings.free_video_limit = 10
    settings.free_monthly_video_limit = 2
    store = MemoryStore()
    quota = QuotaService(settings, store)
    await quota.reserve_video("u1", "aaaaaaaaaaa", PERIOD)
    await quota.reserve_video("u1", "bbbbbbbbbbb", PERIOD)
    with pytest.raises(QuotaExceeded):
        await quota.reserve_video("u1", "ccccccccccc", PERIOD)


async def test_active_subscriber_is_unlimited() -> None:
    store = MemoryStore()
    await store.upsert_subscription("u1", {"status": "ACTIVE"})
    quota = QuotaService(_settings(), store)
    for i in range(10):
        decision = await quota.reserve_video("u1", f"video{i:06d}", PERIOD)
        assert decision.allowed
        assert decision.reason == "pro"


async def test_concurrent_video_reservations_cannot_exceed_limit() -> None:
    store = MemoryStore()
    quota = QuotaService(_settings(), store)

    async def attempt(i: int) -> bool:
        try:
            await quota.reserve_video("u1", f"video{i:06d}", PERIOD)
            return True
        except QuotaExceeded:
            return False

    results = await asyncio.gather(*(attempt(i) for i in range(10)))
    assert sum(results) == 3
    assert len(store.used_videos["u1"]) == 3


async def test_chat_quota() -> None:
    store = MemoryStore()
    quota = QuotaService(_settings(), store)
    await quota.reserve_chat("u1", PERIOD)
    await quota.reserve_chat("u1", PERIOD)
    with pytest.raises(QuotaExceeded):
        await quota.reserve_chat("u1", PERIOD)


async def test_quota_disabled_bypasses() -> None:
    settings = _settings()
    settings.quota_enabled = False
    store = MemoryStore()
    quota = QuotaService(settings, store)
    for i in range(5):
        assert (await quota.reserve_video("u1", f"video{i:06d}", PERIOD)).allowed


class _MissingProfileStore:
    """Store whose RPC reports ``user_missing`` (profile row not yet created)."""

    def __init__(self) -> None:
        self.ensured: list[str] = []

    async def ensure_user(self, user_id: str, email: str | None = None) -> dict:
        self.ensured.append(user_id)
        return {"id": user_id, "email": email}

    async def consume_video_quota(self, user_id: str, video_id: str, **_kwargs) -> dict:
        return {"allowed": False, "reason": "user_missing", "used": 0, "remaining": 0, "limit": 3}

    async def consume_chat_quota(self, user_id: str, **_kwargs) -> dict:
        return {"allowed": False, "reason": "user_missing", "used": 0, "remaining": 0, "limit": 200}


async def test_missing_profile_is_ensured_and_never_blocks_video() -> None:
    store = _MissingProfileStore()
    quota = QuotaService(_settings(), store)
    decision = await quota.reserve_video("u1", "aaaaaaaaaaa", PERIOD)
    assert decision.allowed
    assert store.ensured == ["u1"]


async def test_missing_profile_is_ensured_and_never_blocks_chat() -> None:
    store = _MissingProfileStore()
    quota = QuotaService(_settings(), store)
    decision = await quota.reserve_chat("u1", PERIOD)
    assert decision.allowed
    assert store.ensured == ["u1"]
