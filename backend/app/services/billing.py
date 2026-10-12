"""Razorpay billing.

Flow:
    extension -> POST /billing/create-order -> Razorpay order
    Razorpay Checkout -> user pays
    extension -> POST /billing/verify (order + payment + signature)
    Razorpay -> POST /billing/webhook (signature verified, idempotent)

The database is the source of truth for entitlement. A client can never set
``premium = true``; only a verified signature or a verified webhook can.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.config import Settings
from app.errors import Forbidden, SubscriptionRequired
from app.services.store.base import Store

logger = logging.getLogger("youtube_ai_reader.billing")

_ORDER_ID_RE = re.compile(r"^order_[A-Za-z0-9]+$")


def _hmac_hex(secret: str, message: str) -> str:
    return hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_payment_signature(key_secret: str, order_id: str, payment_id: str, signature: str) -> bool:
    """Payment Checkout signature = HMAC_SHA256(order_id|payment_id, key_secret)."""
    if not key_secret or not order_id or not payment_id or not signature:
        return False
    expected = _hmac_hex(key_secret, f"{order_id}|{payment_id}")
    return hmac.compare_digest(expected, signature)


def verify_webhook_signature(webhook_secret: str, raw_body: bytes, signature: str) -> bool:
    if not webhook_secret or not signature:
        return False
    expected = hmac.new(webhook_secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _period_end(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


class BillingService:
    def __init__(
        self,
        settings: Settings,
        store: Store,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.settings = settings
        self.store = store
        self._client = client
        self._owns_client = client is None

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url="https://api.razorpay.com/v1",
                auth=(self.settings.razorpay_key_id, self.settings.razorpay_key_secret),
                timeout=20.0,
            )
            self._owns_client = True
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------- checkout
    async def create_order(self, user_id: str) -> dict[str, Any]:
        if not self.settings.razorpay_configured:
            raise SubscriptionRequired(
                "Billing is not configured on this server yet. Please try again later."
            )
        client = await self._ensure_client()
        payload = {
            "amount": self.settings.razorpay_plan_amount,
            "currency": self.settings.razorpay_currency,
            "receipt": f"yair_{user_id[:18]}_{int(datetime.now(timezone.utc).timestamp())}",
            "notes": {"user_id": user_id, "plan": self.settings.razorpay_plan_name},
        }
        response = await client.post("/orders", json=payload)
        if response.status_code >= 400:
            logger.warning("[billing] order creation failed: HTTP %d", response.status_code)
            raise SubscriptionRequired("Could not start checkout. Please try again.")
        order = response.json()
        return {
            "order_id": order.get("id"),
            "amount": order.get("amount", payload["amount"]),
            "currency": order.get("currency", payload["currency"]),
            "key_id": self.settings.razorpay_key_id,
            "plan_name": self.settings.razorpay_plan_name,
        }

    async def verify_payment(
        self,
        user_id: str,
        order_id: str,
        payment_id: str,
        signature: str,
    ) -> dict[str, Any]:
        if not verify_payment_signature(
            self.settings.razorpay_key_secret, order_id, payment_id, signature
        ):
            logger.warning("[billing] payment signature rejected user=%s", user_id[:8])
            raise Forbidden("Payment verification failed.")
        return await self._activate(
            user_id,
            payment_id=payment_id,
            subscription_id=None,
            event="payment.verified",
        )

    # -------------------------------------------------- hosted checkout support
    async def get_order(self, order_id: str) -> dict[str, Any]:
        """Fetch an order from Razorpay (server-side, authenticated)."""
        if not self.settings.razorpay_configured:
            raise SubscriptionRequired("Billing is not configured on this server yet.")
        if not _ORDER_ID_RE.match(order_id or ""):
            raise Forbidden("Invalid order id.")
        client = await self._ensure_client()
        response = await client.get(f"/orders/{order_id}")
        if response.status_code >= 400:
            raise Forbidden("Order not found.")
        return response.json()

    async def order_public(self, order_id: str) -> dict[str, Any]:
        """Safe, non-secret order details for the hosted checkout page."""
        order = await self.get_order(order_id)
        return {
            "order_id": order.get("id"),
            "amount": order.get("amount"),
            "currency": order.get("currency"),
            "status": order.get("status"),
            "key_id": self.settings.razorpay_key_id,
            "plan_name": self.settings.razorpay_plan_name,
        }

    async def verify_public(
        self, order_id: str, payment_id: str, signature: str
    ) -> dict[str, Any]:
        """Verify a payment reported by the hosted checkout page.

        The Razorpay signature proves the payment is genuine; the user id comes
        from the order's server-created notes, so no client-supplied identity is
        trusted. Idempotent per payment id.
        """
        if not verify_payment_signature(
            self.settings.razorpay_key_secret, order_id, payment_id, signature
        ):
            logger.warning("[billing] hosted payment signature rejected order=%s", order_id)
            raise Forbidden("Payment verification failed.")
        first_time = await self.store.mark_webhook_processed(
            f"verify_{payment_id}", "razorpay", "payment.verified"
        )
        if not first_time:
            return {"ok": True, "duplicate": True}
        order = await self.get_order(order_id)
        user_id = (order.get("notes") or {}).get("user_id")
        if not user_id:
            raise Forbidden("Order is missing a user reference.")
        subscription = await self._activate(
            str(user_id),
            payment_id=payment_id,
            subscription_id=None,
            event="payment.verified.hosted",
        )
        return {"ok": True, "subscription": subscription}

    # ---------------------------------------------------------- reconcile
    async def reconcile_order(self, order_id: str) -> dict[str, Any]:
        """Server-side reconciliation: activate if Razorpay shows a captured payment.

        Independent of the browser (used by the hosted page and as a safety net
        when a webhook is missed). Idempotent.
        """
        order = await self.get_order(order_id)
        user_id = (order.get("notes") or {}).get("user_id")
        status = order.get("status")
        if not user_id:
            return {"ok": False, "status": status, "reason": "missing_user"}
        if status != "paid":
            return {"ok": False, "status": status, "reason": "not_paid"}
        client = await self._ensure_client()
        response = await client.get(f"/orders/{order_id}/payments")
        payments = response.json().get("items", []) if response.status_code < 400 else []
        captured = next((p for p in payments if p.get("status") == "captured"), None)
        if not captured:
            return {"ok": False, "status": status, "reason": "no_captured_payment"}
        first_time = await self.store.mark_webhook_processed(
            f"reconcile_{captured.get('id')}", "razorpay", "payment.captured"
        )
        if first_time:
            await self._activate(
                str(user_id),
                payment_id=captured.get("id"),
                subscription_id=None,
                event="payment.reconciled",
            )
        return {"ok": True, "status": "paid", "activated": first_time}

    # -------------------------------------------------------------- webhook
    async def handle_webhook(self, raw_body: bytes, signature: str) -> dict[str, Any]:
        if not verify_webhook_signature(self.settings.razorpay_webhook_secret, raw_body, signature):
            raise Forbidden("Invalid webhook signature.")
        import json

        try:
            event = json.loads(raw_body)
        except ValueError as exc:
            raise Forbidden("Invalid webhook payload.") from exc

        event_id = event.get("id") or _hmac_hex("event", raw_body.decode("utf-8", "ignore"))[:32]
        event_type = event.get("event", "")
        first_time = await self.store.mark_webhook_processed(event_id, "razorpay", event_type)
        if not first_time:
            logger.info("[billing] duplicate webhook ignored id=%s", event_id)
            return {"ok": True, "duplicate": True}

        payload = ((event.get("payload") or {}).get("payment") or {}).get("entity") or {}
        subscription = ((event.get("payload") or {}).get("subscription") or {}).get("entity") or {}
        user_id = (
            (payload.get("notes") or {}).get("user_id")
            or (subscription.get("notes") or {}).get("user_id")
        )

        if event_type in ("payment.captured", "order.paid") and user_id:
            await self._activate(
                user_id,
                payment_id=payload.get("id"),
                subscription_id=subscription.get("id"),
                event=event_type,
            )
        elif event_type in ("subscription.activated", "subscription.charged") and user_id:
            period_end = subscription.get("current_end")
            if isinstance(period_end, (int, float)):
                period_end = datetime.fromtimestamp(period_end, tz=timezone.utc).isoformat()
            await self._activate(
                user_id,
                payment_id=payload.get("id"),
                subscription_id=subscription.get("id"),
                event=event_type,
                current_period_end=period_end,
            )
        elif event_type == "subscription.cancelled" and user_id:
            await self.store.upsert_subscription(
                user_id, {"status": "CANCELLED", "provider_subscription_id": subscription.get("id")}
            )
        elif event_type in ("subscription.halted", "payment.failed") and user_id:
            await self.store.upsert_subscription(
                user_id, {"status": "PAST_DUE", "provider_subscription_id": subscription.get("id")}
            )
        else:
            logger.info("[billing] unhandled webhook event=%s", event_type)
        return {"ok": True, "event": event_type}

    # -------------------------------------------------------------- internal
    async def _activate(
        self,
        user_id: str,
        *,
        payment_id: str | None,
        subscription_id: str | None,
        event: str,
        current_period_end: str | None = None,
    ) -> dict[str, Any]:
        record = await self.store.upsert_subscription(
            user_id,
            {
                "status": "ACTIVE",
                "plan": "pro",
                "provider": "razorpay",
                "provider_payment_id": payment_id,
                "provider_subscription_id": subscription_id,
                "current_period_start": datetime.now(timezone.utc).isoformat(),
                "current_period_end": current_period_end
                or _period_end(self.settings.razorpay_plan_period_days),
            },
        )
        try:
            await self.store.ensure_user(user_id)
            await self.store.update_user(user_id, {"plan": "pro"})
        except Exception:  # noqa: BLE001 - profile update is not critical
            logger.debug("[billing] user plan update failed", exc_info=True)
        logger.info("[billing] subscription activated user=%s event=%s", user_id[:8], event)
        return record

    async def decorate_status(self, user_id: str) -> dict[str, Any]:
        """Normalize an expired subscription on read (self-healing)."""
        subscription = await self.store.get_subscription(user_id)
        if not subscription:
            return {"status": "FREE", "plan": "free", "active": False}
        status = subscription.get("status", "FREE")
        period_end = subscription.get("current_period_end")
        if status == "ACTIVE" and period_end:
            try:
                end = datetime.fromisoformat(str(period_end).replace("Z", "+00:00"))
                if end < datetime.now(timezone.utc):
                    await self.store.upsert_subscription(user_id, {"status": "EXPIRED"})
                    await self.store.update_user(user_id, {"plan": "free"})
                    status = "EXPIRED"
            except ValueError:
                pass
        return {
            "status": status,
            "plan": subscription.get("plan", "free"),
            "current_period_end": period_end,
            "active": status == "ACTIVE",
        }
