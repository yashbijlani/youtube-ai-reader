"""HTTP API routes."""

from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse, StreamingResponse

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
from app.services.quota import QuotaService
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


async def enforce_video_quota(request: Request, video_id: str) -> None:
    """Server-side quota enforcement.

    Authenticated users are enforced from the database (atomic reservation).
    Anonymous requests only occur in development (``AUTH_REQUIRED=false``) and
    fall back to the legacy install-id limit.
    """
    user_id = verified_user_id(request)
    if user_id:
        quota = QuotaService(get_settings(request), get_store(request))
        await quota.reserve_video(user_id, video_id, current_period())
        return
    enforce_free_limit(request, video_id)
    get_usage(request).record_video(install_id(request) or "", video_id)


async def enforce_chat_quota(request: Request) -> None:
    user_id = verified_user_id(request)
    if user_id:
        quota = QuotaService(get_settings(request), get_store(request))
        await quota.reserve_chat(user_id, current_period())


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
    period = current_period()
    if not user_id:
        return {
            "authenticated": False,
            "user": None,
            "subscription": None,
            "usage": {
                "period": period,
                "videos_used": 0,
                "chat_messages": 0,
                "ai_cost_usd": 0.0,
                "lifetime_videos": 0,
                "free_limit": settings.free_video_limit,
                "free_monthly_limit": settings.free_monthly_video_limit,
            },
        }
    user = await store.get_user(user_id) or await store.ensure_user(user_id)
    subscription = await store.get_subscription(user_id)
    used = await store.get_used_videos(user_id)
    period_usage = await store.get_period_usage(user_id, period)
    status = (subscription or {}).get("status", "FREE")
    return {
        "authenticated": True,
        "user": {"id": user_id, "email": (user or {}).get("email"), "plan": (user or {}).get("plan", "free")},
        "subscription": {
            "status": status,
            "plan": (subscription or {}).get("plan", "free"),
            "current_period_end": (subscription or {}).get("current_period_end"),
            "active": status == "ACTIVE",
        },
        "usage": {
            "period": period,
            "videos_used": int(period_usage.get("videos_used", 0)),
            "chat_messages": int(period_usage.get("chat_messages", 0)),
            "ai_cost_usd": float(period_usage.get("ai_cost_usd", 0.0)),
            "lifetime_videos": len(used),
            "free_limit": settings.free_video_limit,
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
    await enforce_video_quota(request, video_id)
    service = get_service(request)
    state = await service.process(
        payload.youtube_url, force=payload.force, user_id=current_user_id(request)
    )
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
    await enforce_video_quota(request, video_id)
    service = get_service(request)
    state = await service.ingest(video_id, payload, user_id=current_user_id(request))
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
