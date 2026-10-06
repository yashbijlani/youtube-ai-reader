"""FastAPI application entrypoint for YouTube AI Reader."""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import API_VERSION, router
from app.config import Settings, get_settings
from app.errors import AppError
from app.logging_conf import configure_logging
from app.services.ai import create_provider
from app.services.ai.usage import AIUsageRecorder
from app.services.auth import SupabaseAuth
from app.services.cache import FileCache
from app.services.rate_limit import limiter
from app.services.store import create_store
from app.services.transcript import YtDlpTranscriptProvider
from app.services.usage import UsageStore
from app.services.video_service import VideoService

logger = logging.getLogger("youtube_ai_reader")

_ensured_users: set[str] = set()
_linked_devices: set[str] = set()


async def _ensure_user_best_effort(
    app: FastAPI, user_id: str, email: str | None, install_id: str | None
) -> None:
    """Create the profile / link the device once per process (best effort)."""
    store = getattr(app.state, "store", None)
    if store is None:
        return
    try:
        if user_id not in _ensured_users:
            await store.ensure_user(user_id, email)
            _ensured_users.add(user_id)
        if install_id:
            key = f"{user_id}:{install_id}"
            if key not in _linked_devices:
                await store.link_device(install_id, user_id)
                _linked_devices.add(key)
    except Exception:  # noqa: BLE001 - never block a request on profile bookkeeping
        logger.debug("[auth] profile/device upsert failed", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    configure_logging(settings.log_level)
    cache = FileCache(settings)
    if settings.cache_enabled:
        settings.cache_dir.mkdir(parents=True, exist_ok=True)
    ai_provider = create_provider(settings)
    transcript_provider = YtDlpTranscriptProvider(settings)
    store = create_store(settings)
    auth = SupabaseAuth(settings)
    app.state.auth = auth

    async def _usage_sink(record) -> None:  # noqa: ANN001
        await store.save_ai_usage(record.to_row())

    usage_recorder = AIUsageRecorder(sink=_usage_sink)
    app.state.store = store
    app.state.video_service = VideoService(
        settings, cache, transcript_provider, ai_provider, usage_recorder=usage_recorder, store=store
    )
    app.state.usage_store = UsageStore(settings)
    logger.info(
        "[startup] YouTube AI Reader %s model=%s ai_configured=%s storage=%s cache=%s",
        API_VERSION,
        settings.gemini_model_main,
        settings.ai_configured,
        type(store).__name__,
        settings.cache_dir if settings.cache_enabled else "disabled",
    )
    if settings.is_production:
        if not settings.auth_required:
            logger.warning("[startup] SECURITY: AUTH_REQUIRED is false in production")
        if not settings.supabase_configured:
            logger.warning("[startup] SECURITY: Supabase is not configured in production (state is in-memory)")
        if settings.storage_backend == "filesystem":
            logger.warning("[startup] SECURITY: STORAGE_BACKEND=filesystem in production")
    try:
        yield
    finally:
        await app.state.video_service.aclose()
        await store.aclose()
        limiter.prune()
        logger.info("[shutdown] bye")


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(
        title="YouTube AI Reader API",
        version=API_VERSION,
        lifespan=lifespan,
        docs_url="/docs",
    )
    app.state.settings = settings or get_settings()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=app.state.settings.cors_origins,
        allow_origin_regex=app.state.settings.cors_allow_origin_regex,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-Install-Id"],
        max_age=3600,
    )

    @app.middleware("http")
    async def authenticate_request(request: Request, call_next):
        """Verify the Supabase JWT and attach the verified user id.

        Public endpoints are skipped. In development (``AUTH_REQUIRED=false``)
        requests without a token are allowed and fall back to the install id
        for local usage tracking only.
        """
        settings: Settings = app.state.settings
        path = request.url.path
        public = (
            request.method == "OPTIONS"
            or path in ("/api/health",)
            or path.startswith("/api/billing/webhook")
            or path.startswith("/api/billing/checkout")
            or path.startswith("/api/billing/order/")
            or path == "/api/billing/verify-public"
            or not path.startswith("/api")
        )
        if public:
            return await call_next(request)

        auth: SupabaseAuth = app.state.auth
        header = request.headers.get("authorization", "")
        user = None
        if header.lower().startswith("bearer "):
            token = header.split(" ", 1)[1].strip()
            try:
                user = await auth.verify(token)
            except AppError as exc:
                return JSONResponse(
                    status_code=exc.status_code,
                    content={"error": {"code": exc.code, "message": exc.message}},
                )
        if user is None and settings.auth_required:
            return JSONResponse(
                status_code=401,
                content={"error": {"code": "unauthorized", "message": "Please sign in to continue."}},
            )
        if user is not None:
            request.state.user_id = user.id
            request.state.user_email = user.email
            await _ensure_user_best_effort(app, user.id, user.email, request.headers.get("x-install-id"))
        return await call_next(request)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    @app.middleware("http")
    async def access_log_and_general_limit(request: Request, call_next):
        settings: Settings = app.state.settings
        path = request.url.path
        # CORS preflight requests must not be rate-limited or authenticated, or
        # the browser never receives Access-Control-Allow-* headers.
        if path.startswith("/api") and path != "/api/health" and request.method != "OPTIONS":
            ip = request.client.host if request.client else "unknown"
            if settings.trust_proxy and request.headers.get("x-forwarded-for"):
                ip = request.headers["x-forwarded-for"].split(",")[0].strip()
            try:
                limiter.check(
                    f"general:{ip}", settings.rate_limit_general_per_minute, 60
                )
            except AppError as exc:
                return JSONResponse(
                    status_code=exc.status_code,
                    content={"error": {"code": exc.code, "message": exc.message}},
                )
        started = time.monotonic()
        response = await call_next(request)
        if path.startswith("/api"):
            duration_ms = int((time.monotonic() - started) * 1000)
            is_state_poll = request.method == "GET" and path.startswith("/api/videos/")
            if is_state_poll and response.status_code < 400 and not settings.log_poll_requests:
                logger.debug("%s %s -> %d (%dms)", request.method, path, response.status_code, duration_ms)
            else:
                logger.info("%s %s -> %d (%dms)", request.method, path, response.status_code, duration_ms)
        return response

    @app.exception_handler(AppError)
    async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(part) for part in first.get("loc", []) if part != "body")
        message = first.get("msg", "Invalid request.")
        friendly = f"Invalid request ({field}): {message}" if field else f"Invalid request: {message}"
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "invalid_request", "message": friendly}},
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("[api] unhandled error: %s", exc)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "Something went wrong on the server. Please try again.",
                }
            },
        )

    app.include_router(router)
    return app


app = create_app()


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=True)
