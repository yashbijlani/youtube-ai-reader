"""Razorpay billing tests (signature verification, activation, idempotency)."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.config import Settings
from app.errors import Forbidden, SubscriptionRequired
from app.services.billing import (
    BillingService,
    verify_payment_signature,
    verify_webhook_signature,
)
from app.services.store.memory_store import MemoryStore

KEY_SECRET = "rzp-secret"
WEBHOOK_SECRET = "wh-secret"


def _settings() -> Settings:
    settings = Settings(_env_file=None)
    settings.razorpay_key_id = "rzp_test_key"
    settings.razorpay_key_secret = KEY_SECRET
    settings.razorpay_webhook_secret = WEBHOOK_SECRET
    settings.razorpay_plan_amount = 49_900
    settings.razorpay_plan_period_days = 30
    return settings


def _payment_sig(order: str, payment: str) -> str:
    return hmac.new(KEY_SECRET.encode(), f"{order}|{payment}".encode(), hashlib.sha256).hexdigest()


def _webhook_sig(body: bytes) -> str:
    return hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()


def test_payment_signature_verification() -> None:
    assert verify_payment_signature(KEY_SECRET, "order_1", "pay_1", _payment_sig("order_1", "pay_1"))
    assert not verify_payment_signature(KEY_SECRET, "order_1", "pay_1", "deadbeef")
    assert not verify_payment_signature("", "order_1", "pay_1", "x")


def test_webhook_signature_verification() -> None:
    body = b'{"event":"payment.captured"}'
    assert verify_webhook_signature(WEBHOOK_SECRET, body, _webhook_sig(body))
    assert not verify_webhook_signature(WEBHOOK_SECRET, body, "nope")


async def test_create_order_calls_razorpay() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "order_abc", "amount": 49900, "currency": "INR"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://api.razorpay.com/v1")
    service = BillingService(_settings(), MemoryStore(), client=client)
    order = await service.create_order("user-1")
    assert order["order_id"] == "order_abc"
    assert order["key_id"] == "rzp_test_key"
    body = json.loads(seen[0].content)
    assert body["amount"] == 49900 and body["notes"]["user_id"] == "user-1"
    await client.aclose()


async def test_create_order_without_config_raises() -> None:
    service = BillingService(Settings(_env_file=None), MemoryStore())
    with pytest.raises(SubscriptionRequired):
        await service.create_order("user-1")


async def test_verify_payment_activates_subscription() -> None:
    store = MemoryStore()
    service = BillingService(_settings(), store)
    subscription = await service.verify_payment(
        "user-1", "order_1", "pay_1", _payment_sig("order_1", "pay_1")
    )
    assert subscription["status"] == "ACTIVE"
    assert (await store.get_user("user-1") or {})  # user plan update is best effort
    with pytest.raises(Forbidden):
        await service.verify_payment("user-1", "order_1", "pay_1", "bad")


async def test_webhook_activates_and_is_idempotent() -> None:
    store = MemoryStore()
    service = BillingService(_settings(), store)
    event = {
        "id": "evt_1",
        "event": "payment.captured",
        "payload": {"payment": {"entity": {"id": "pay_9", "notes": {"user_id": "user-1"}}}},
    }
    body = json.dumps(event).encode()
    signature = _webhook_sig(body)

    result = await service.handle_webhook(body, signature)
    assert result["ok"] and not result.get("duplicate")
    assert (await store.get_subscription("user-1"))["status"] == "ACTIVE"

    # Replaying the same event must not change state twice / must be ignored.
    result2 = await service.handle_webhook(body, signature)
    assert result2.get("duplicate") is True


async def test_webhook_rejects_bad_signature() -> None:
    service = BillingService(_settings(), MemoryStore())
    with pytest.raises(Forbidden):
        await service.handle_webhook(b'{"id":"e"}', "bad-signature")


async def test_webhook_cancellation_and_past_due() -> None:
    store = MemoryStore()
    service = BillingService(_settings(), store)

    cancelled = {
        "id": "evt_cancel",
        "event": "subscription.cancelled",
        "payload": {"subscription": {"entity": {"id": "sub_1", "notes": {"user_id": "user-1"}}}},
    }
    body = json.dumps(cancelled).encode()
    await service.handle_webhook(body, _webhook_sig(body))
    assert (await store.get_subscription("user-1"))["status"] == "CANCELLED"

    failed = {
        "id": "evt_fail",
        "event": "payment.failed",
        "payload": {"payment": {"entity": {"id": "pay_x", "notes": {"user_id": "user-1"}}}},
    }
    body = json.dumps(failed).encode()
    await service.handle_webhook(body, _webhook_sig(body))
    assert (await store.get_subscription("user-1"))["status"] == "PAST_DUE"


async def test_decorate_status_expires_old_subscription() -> None:
    store = MemoryStore()
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    await store.upsert_subscription("user-1", {"status": "ACTIVE", "plan": "pro", "current_period_end": past})
    service = BillingService(_settings(), store)
    status = await service.decorate_status("user-1")
    assert status["status"] == "EXPIRED"
    assert status["active"] is False


async def test_api_webhook_and_billing_endpoints(tmp_path) -> None:
    """Webhook is public but signature-verified; checkout requires auth."""
    import jwt
    from fastapi.testclient import TestClient

    from app.main import create_app

    settings = Settings(_env_file=None)
    settings.gemini_api_key = "test-key"
    settings.data_dir = tmp_path
    settings.auth_required = True
    settings.supabase_jwt_secret = "jwt-secret"
    settings.razorpay_key_id = "rzp_test_key"
    settings.razorpay_key_secret = KEY_SECRET
    settings.razorpay_webhook_secret = WEBHOOK_SECRET
    settings.rate_limit_general_per_minute = 0

    app = create_app(settings)
    with TestClient(app) as client:
        assert client.post("/api/billing/create-order").status_code == 401

        # Public webhook, invalid signature -> 403
        bad = client.post("/api/billing/webhook", content=b'{"id":"e1"}', headers={"x-razorpay-signature": "bad"})
        assert bad.status_code == 403

        # Valid webhook activates the user.
        user_id = "33333333-3333-3333-3333-333333333333"
        token = jwt.encode(
            {"sub": user_id, "aud": "authenticated", "role": "authenticated", "exp": 9_999_999_999},
            "jwt-secret",
            algorithm="HS256",
        )
        event = {
            "id": "evt_api",
            "event": "payment.captured",
            "payload": {"payment": {"entity": {"id": "pay_1", "notes": {"user_id": user_id}}}},
        }
        body = json.dumps(event).encode()
        ok = client.post(
            "/api/billing/webhook",
            content=body,
            headers={"x-razorpay-signature": _webhook_sig(body), "Content-Type": "application/json"},
        )
        assert ok.status_code == 200
        me = client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).json()
        assert me["subscription"]["active"] is True
