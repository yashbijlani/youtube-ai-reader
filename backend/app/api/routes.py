"""HTTP API routes."""

from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, StreamingResponse

from app.api.checkout import checkout_html
from app.config import Settings
from app.errors import (
    AppError,
    Forbidden,
    FreeLimitReached,
    InvalidYouTubeUrl,
    ProcessingInProgress,
    Unauthorized,
    VideoNotProcessed,
)
from app.models.schemas import (
    ChatRequest,
    HealthResponse,
    IngestRequest,
    ProcessRequest,
    StatsResponse,
    VerifyPaymentRequest,
    VideoState,
)
from app.services.billing import BillingService
from app.services.metrics import metrics
from app.services.quota import QuotaReservation, QuotaService
from app.services.rate_limit import limiter
from app.services.usage import UsageStore
from app.services.video_service import VideoService
from app.services.youtube import VIDEO_ID_RE, extract_video_id

logger = logging.getLogger("youtube_ai_reader.api")

router = APIRouter(prefix="/api")
API_VERSION = "0.1.0"


def get_service(request: Request) -> VideoService:
    return request.app.state.video_service


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_usage(request: Request) -> UsageStore:
    return request.app.state.usage_store


def get_store(request: Request):
    return request.app.state.store


def current_period() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def period_for(subscription: dict | None) -> str:
    """Quota period key: anchored to the Pro cycle start, else calendar month."""
    if subscription and subscription.get("status") == "ACTIVE":
        start = subscription.get("current_period_start") or subscription.get("current_period_end")
        if start:
            try:
                when = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
                return f"pro-{when.date().isoformat()}"
            except ValueError:
                pass
        return "pro-current"
    return current_period()


def days_left(period_end: str | None) -> int | None:
    if not period_end:
        return None
    try:
        end = datetime.fromisoformat(str(period_end).replace("Z", "+00:00"))
    except ValueError:
        return None
    return max((end - datetime.now(timezone.utc)).days, 0)


def verified_user_id(request: Request) -> str | None:
    return getattr(request.state, "user_id", None)


def install_id(request: Request) -> str | None:
    value = request.headers.get("x-install-id")
    return value.strip() if value else None


def current_user_id(request: Request) -> str | None:
    """Authenticated user id set by the auth dependency (Phase 4).

    Falls back to the anonymous install id in development when auth is optional.
    """
    user_id = getattr(request.state, "user_id", None)
    if user_id:
        return str(user_id)
    settings = get_settings(request)
    if settings.auth_required:
        return None
    return install_id(request)


def enforce_free_limit(request: Request, video_id: str) -> None:
    store = get_usage(request)
    allowed, remaining = store.can_process(install_id(request) or "", video_id)
    if not allowed:
        raise FreeLimitReached(store.limit, remaining)


async def refund_reservation(request: Request, reservation: "QuotaReservation | None") -> None:
    """Release a reserved slot when a request fails synchronously."""
    if reservation is None or not reservation.charged:
        return
    try:
        quota = QuotaService(get_settings(request), get_store(request))
        await quota.release_video(reservation.user_id, reservation.video_id, reservation.period)
    except Exception:  # noqa: BLE001 - refund is best-effort
        logger.warning("[quota] route refund failed", exc_info=True)


async def enforce_video_quota(request: Request, video_id: str) -> "QuotaReservation | None":
    """Server-side quota enforcement.

    Authenticated users are enforced from the database (atomic reservation) and
    a refundable reservation is returned. Anonymous requests only occur in
    development (``AUTH_REQUIRED=false``) and use the legacy install-id limit.
    """
    user_id = verified_user_id(request)
    if user_id:
        quota = QuotaService(get_settings(request), get_store(request))
        period = await billing_period(request, user_id)
        decision = await quota.reserve_video(user_id, video_id, period)
        return QuotaReservation(
            user_id=user_id,
            video_id=video_id,
            period=period,
            plan=decision.plan,
            charged=decision.reason == "ok",
            max_video_minutes=quota.max_video_minutes(decision.plan),
        )
    enforce_free_limit(request, video_id)
    get_usage(request).record_video(install_id(request) or "", video_id)
    return None


async def enforce_chat_quota(request: Request) -> None:
    user_id = verified_user_id(request)
    if user_id:
        quota = QuotaService(get_settings(request), get_store(request))
        period = await billing_period(request, user_id)
        await quota.reserve_chat(user_id, period)


async def billing_period(request: Request, user_id: str) -> str:
    """Quota period key: anchored to the Pro cycle start, else calendar month."""
    try:
        subscription = await get_store(request).get_subscription(user_id)
    except Exception:  # noqa: BLE001 - period must never break a request
        subscription = None
    return period_for(subscription)


def client_ip(request: Request, settings: Settings) -> str:
    if settings.trust_proxy:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def validate_video_id(video_id: str) -> str:
    if not VIDEO_ID_RE.match(video_id or ""):
        raise InvalidYouTubeUrl("Invalid video ID.")
    return video_id


async def enforce_rate(request: Request, bucket: str, limit: int, window: float) -> None:
    settings = get_settings(request)
    ip = client_ip(request, settings)
    limiter.check(f"{bucket}:{ip}", limit, window)


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    settings = get_settings(request)
    return HealthResponse(
        status="ok",
        version=API_VERSION,
        ai_configured=settings.ai_configured,
        model=settings.gemini_model_main,
        fast_model=settings.effective_fast_model,
    )


@router.get("/stats", response_model=StatsResponse)
async def stats() -> StatsResponse:
    return StatsResponse(**metrics.snapshot())


# ------------------------------------------------------------------ account


async def _account_payload(request: Request) -> dict:
    store = get_store(request)
    settings = get_settings(request)
    user_id = verified_user_id(request)
    if not user_id:
        return {
            "authenticated": False,
            "user": None,
            "subscription": None,
            "usage": {
                "period": current_period(),
                "videos_used": 0,
                "chat_messages": 0,
                "ai_cost_usd": 0.0,
                "lifetime_videos": 0,
                "limit": settings.free_monthly_video_limit,
                "remaining": settings.free_monthly_video_limit,
                "plan": "free",
                "free_limit": settings.free_monthly_video_limit,
                "free_monthly_limit": settings.free_monthly_video_limit,
            },
        }
    user = await store.get_user(user_id) or await store.ensure_user(user_id)
    subscription = await store.get_subscription(user_id)
    used = await store.get_used_videos(user_id)
    status = (subscription or {}).get("status", "FREE")
    plan = "pro" if status == "ACTIVE" else "free"
    period = period_for(subscription)
    period_usage = await store.get_period_usage(user_id, period)
    limit = (
        settings.pro_monthly_video_limit
        if plan == "pro"
        else settings.free_monthly_video_limit
    )
    videos_used = int(period_usage.get("videos_used", 0))
    period_end = (subscription or {}).get("current_period_end")
    return {
        "authenticated": True,
        "user": {"id": user_id, "email": (user or {}).get("email"), "plan": plan},
        "subscription": {
            "status": status,
            "plan": plan,
            "current_period_end": period_end,
            "days_left": days_left(period_end),
            "active": status == "ACTIVE",
        },
        "usage": {
            "period": period,
            "videos_used": videos_used,
            "chat_messages": int(period_usage.get("chat_messages", 0)),
            "ai_cost_usd": float(period_usage.get("ai_cost_usd", 0.0)),
            "limit": limit,
            "remaining": max(limit - videos_used, 0),
            "plan": plan,
            "lifetime_videos": len(used),
            "free_limit": settings.free_monthly_video_limit,
            "free_monthly_limit": settings.free_monthly_video_limit,
        },
    }


@router.get("/me")
async def me(request: Request) -> dict:
    """Authoritative account/subscription/usage information."""
    return await _account_payload(request)


@router.get("/me/usage")
async def my_usage(request: Request) -> dict:
    return (await _account_payload(request))["usage"]


@router.post("/me/device")
async def link_my_device(request: Request) -> dict:
    user_id = verified_user_id(request)
    if not user_id:
        raise Unauthorized()
    install = install_id(request)
    if install:
        await get_store(request).link_device(install, user_id)
    return {"ok": True}


# ------------------------------------------------------------------ billing


def get_billing(request: Request) -> BillingService:
    return BillingService(get_settings(request), get_store(request))


@router.post("/billing/create-order")
async def billing_create_order(request: Request) -> dict:
    user_id = verified_user_id(request)
    if not user_id:
        raise Unauthorized("Please sign in to upgrade.")
    return await get_billing(request).create_order(user_id)


@router.post("/billing/verify")
async def billing_verify(request: Request, payload: VerifyPaymentRequest) -> dict:
    user_id = verified_user_id(request)
    if not user_id:
        raise Unauthorized("Please sign in to complete your purchase.")
    subscription = await get_billing(request).verify_payment(
        user_id,
        payload.razorpay_order_id,
        payload.razorpay_payment_id,
        payload.razorpay_signature,
    )
    return {"ok": True, "subscription": subscription}


@router.get("/billing/subscription")
async def billing_subscription(request: Request) -> dict:
    user_id = verified_user_id(request)
    if not user_id:
        return {"status": "FREE", "plan": "free", "active": False}
    return await get_billing(request).decorate_status(user_id)


@router.get("/billing/checkout", response_class=HTMLResponse)
async def billing_checkout() -> HTMLResponse:
    """Hosted Razorpay Checkout page (opened in a browser tab by the extension).

    Public: the page only exposes non-secret order details and delegates identity
    to the order's server-created notes at verification time.
    """
    return HTMLResponse(checkout_html())


@router.get("/billing/order/{order_id}")
async def billing_order(request: Request, order_id: str) -> dict:
    """Public, non-secret order details for the hosted checkout page."""
    return await get_billing(request).order_public(order_id)


@router.post("/billing/verify-public")
async def billing_verify_public(request: Request, payload: VerifyPaymentRequest) -> dict:
    """Verify a payment from the hosted checkout page (signature-based)."""
    return await get_billing(request).verify_public(
        payload.razorpay_order_id,
        payload.razorpay_payment_id,
        payload.razorpay_signature,
    )


@router.post("/billing/reconcile/{order_id}")
async def billing_reconcile(request: Request, order_id: str) -> dict:
    """Activate a paid order server-side (idempotent, no client signature needed)."""
    return await get_billing(request).reconcile_order(order_id)


@router.post("/billing/webhook")
async def billing_webhook(request: Request) -> dict:
    """Razorpay webhook. Signature is verified against the raw request body."""
    body = await request.body()
    signature = request.headers.get("x-razorpay-signature", "")
    return await get_billing(request).handle_webhook(body, signature)


@router.post("/videos/process", response_model=VideoState)
async def process_video(request: Request, payload: ProcessRequest) -> VideoState:
    settings = get_settings(request)
    await enforce_rate(request, "process", settings.rate_limit_process_per_hour, 3600)
    video_id = extract_video_id(payload.youtube_url)
    quota = await enforce_video_quota(request, video_id)
    service = get_service(request)
    try:
        state = await service.process(
            payload.youtube_url, force=payload.force, user_id=current_user_id(request), quota=quota
        )
    except Exception:
        await refund_reservation(request, quota)
        raise
    return state


@router.get("/usage")
async def usage_status(request: Request) -> dict:
    return get_usage(request).status(install_id(request))


@router.get("/videos/{video_id}", response_model=VideoState)
async def get_video(request: Request, video_id: str) -> VideoState:
    service = get_service(request)
    return service.get_state(validate_video_id(video_id))


@router.post("/videos/{video_id}/ingest", response_model=VideoState)
async def ingest_transcript(request: Request, video_id: str, payload: IngestRequest) -> VideoState:
    """Accept a transcript captured client-side (the user's own YouTube session)."""
    settings = get_settings(request)
    validate_video_id(video_id)
    if not settings.trust_client_transcripts:
        raise Forbidden("This server does not accept client-supplied transcripts.")
    await enforce_rate(request, "process", settings.rate_limit_process_per_hour, 3600)
    quota = await enforce_video_quota(request, video_id)
    service = get_service(request)
    try:
        state = await service.ingest(video_id, payload, user_id=current_user_id(request), quota=quota)
    except Exception:
        await refund_reservation(request, quota)
        raise
    return state


@router.post("/videos/{video_id}/repair", response_model=VideoState)
async def repair_video(request: Request, video_id: str) -> VideoState:
    settings = get_settings(request)
    validate_video_id(video_id)
    await enforce_rate(request, "process", settings.rate_limit_process_per_hour, 3600)
    service = get_service(request)
    return await service.repair(video_id, user_id=current_user_id(request))


@router.get("/videos/{video_id}/transcript", response_model=None)
async def get_transcript(
    request: Request, video_id: str, format: str = "json"
) -> dict | PlainTextResponse:
    service = get_service(request)
    transcript = service.load_transcript(validate_video_id(video_id))
    if format == "text":
        from app.utils.timestamps import format_timestamp

        lines = [f"[{format_timestamp(s.start)}] {s.text}" for s in transcript.segments]
        return PlainTextResponse("\n\n".join(lines))
    return transcript.model_dump()


@router.post("/videos/{video_id}/reprocess", response_model=VideoState)
async def reprocess_video(request: Request, video_id: str) -> VideoState:
    settings = get_settings(request)
    await enforce_rate(request, "process", settings.rate_limit_process_per_hour, 3600)
    service = get_service(request)
    return await service.reprocess(validate_video_id(video_id), user_id=current_user_id(request))


@router.post("/videos/{video_id}/cancel")
async def cancel_video(request: Request, video_id: str) -> dict:
    service = get_service(request)
    return {"ok": service.cancel(validate_video_id(video_id))}


@router.post("/videos/{video_id}/summarize")
async def summarize(request: Request, video_id: str):
    """Stream a grounded summary; usable as soon as the transcript exists."""
    settings = get_settings(request)
    validate_video_id(video_id)
    await enforce_rate(request, "chat", settings.rate_limit_chat_per_hour, 3600)
    await enforce_chat_quota(request)
    service = get_service(request)

    generator = service.stream_summary(video_id, user_id=current_user_id(request))
    first_event: dict | None = None
    try:
        first_event = await generator.__anext__()
    except StopAsyncIteration:
        first_event = None
    except AppError:
        await generator.aclose()
        raise

    async def event_stream() -> AsyncIterator[str]:
        if first_event is not None:
            yield _sse(first_event)
        try:
            async for event in generator:
                yield _sse(event)
        except AppError as exc:
            yield _sse({"type": "error", "code": exc.code, "message": exc.message})
        except Exception:  # noqa: BLE001
            logger.exception("[chat] summary stream failed id=%s", video_id)
            yield _sse(
                {
                    "type": "error",
                    "code": "internal_error",
                    "message": "The summary stream was interrupted. Please try again.",
                }
            )
        finally:
            await generator.aclose()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/videos/{video_id}/analysis/stream")
async def analysis_stream(request: Request, video_id: str):
    """Server-sent stream of the reading guide (parts + reading tokens)."""
    service = get_service(request)
    validate_video_id(video_id)
    state = service.get_state(video_id)
    if state.status == "processing":
        raise ProcessingInProgress()
    if state.status != "ready":
        raise VideoNotProcessed(video_id)

    generator = service.stream_analysis(video_id)

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for event in generator:
                yield _sse(event)
        except AppError as exc:
            yield _sse({"type": "error", "code": exc.code, "message": exc.message})
        except Exception:  # noqa: BLE001
            logger.exception("[events] analysis stream failed id=%s", video_id)
            yield _sse(
                {
                    "type": "error",
                    "code": "internal_error",
                    "message": "The analysis stream was interrupted.",
                }
            )
        finally:
            await generator.aclose()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/videos/{video_id}/chat")
async def chat(request: Request, video_id: str, payload: ChatRequest):
    settings = get_settings(request)
    validate_video_id(video_id)
    await enforce_rate(request, "chat", settings.rate_limit_chat_per_hour, 3600)
    await enforce_chat_quota(request)
    if len(payload.message) > settings.max_chat_message_chars:
        payload.message = payload.message[: settings.max_chat_message_chars]
    service = get_service(request)

    if not payload.stream:
        return await service.chat(video_id, payload, user_id=current_user_id(request))

    generator = service.stream_chat(video_id, payload, user_id=current_user_id(request))
    first_event: dict | None = None
    try:
        first_event = await generator.__anext__()
    except StopAsyncIteration:
        first_event = None
    except AppError:
        await generator.aclose()
        raise
    except Exception:  # noqa: BLE001 - fall back to the non-streaming path
        logger.warning("[chat] streaming unavailable, falling back id=%s", video_id)
        await generator.aclose()
        return await service.chat(video_id, payload, user_id=current_user_id(request))

    async def event_stream() -> AsyncIterator[str]:
        if first_event is not None:
            yield _sse(first_event)
        try:
            async for event in generator:
                yield _sse(event)
        except AppError as exc:
            yield _sse({"type": "error", "code": exc.code, "message": exc.message})
        except Exception:  # noqa: BLE001
            logger.exception("[chat] stream failed id=%s", video_id)
            yield _sse(
                {
                    "type": "error",
                    "code": "internal_error",
                    "message": "The answer stream was interrupted. Please try again.",
                }
            )
        finally:
            await generator.aclose()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@router.get("/debug/time")
async def debug_time() -> dict:  # pragma: no cover - trivial
    return {"now": time.time()}
