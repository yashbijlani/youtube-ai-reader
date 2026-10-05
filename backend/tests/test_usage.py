"""Usage / free-preview limit tests."""

from __future__ import annotations

from app.config import Settings
from app.services.usage import UsageStore


def test_install_id_validation() -> None:
    assert UsageStore.valid_install_id("abcd1234-efgh-5678")
    assert not UsageStore.valid_install_id("short")
    assert not UsageStore.valid_install_id("bad id with spaces")
    assert not UsageStore.valid_install_id(None)


def test_free_limit_counts_distinct_videos(settings: Settings) -> None:
    settings.free_video_limit = 2
    store = UsageStore(settings)
    iid = "install-abcdefgh"
    assert store.can_process(iid, "vid00000001") == (True, 2)
    store.record_video(iid, "vid00000001")
    assert store.can_process(iid, "vid00000001") == (True, 1)  # repeat is free
    assert store.can_process(iid, "vid00000002") == (True, 1)
    store.record_video(iid, "vid00000002")
    assert store.can_process(iid, "vid00000003") == (False, 0)


def test_paid_bypasses_limit(settings: Settings) -> None:
    settings.free_video_limit = 1
    store = UsageStore(settings)
    iid = "install-paid0001"
    store.record_video(iid, "vid00000001")
    assert store.can_process(iid, "vid00000002")[0] is False
    store.set_paid(iid, True, email="a@b.com")
    assert store.can_process(iid, "vid00000002") == (True, 0)
    status = store.status(iid)
    assert status["paid"] is True and status["remaining"] == 0


def test_missing_install_id_is_unrestricted(settings: Settings) -> None:
    store = UsageStore(settings)
    assert store.can_process("", "vid00000001") == (True, store.limit)
    assert store.status(None)["used"] == 0
