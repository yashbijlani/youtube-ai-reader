"""Application configuration — one authoritative settings object.

All secrets and tunables come from environment variables (or a local .env
file). The Gemini API key, Supabase service-role key and Razorpay secrets are
read only here, on the server.

Canonical names are ``GEMINI_*`` / ``SUPABASE_*`` / ``RAZORPAY_*``. Legacy
``OPENCODE_*`` names are still accepted as aliases so existing local .env files
keep working, but new deployments should use the canonical names.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _alias(*names: str) -> AliasChoices:
    return AliasChoices(*names)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        extra="ignore",
        case_sensitive=False,
    )

    # ------------------------------------------------------------- runtime
    environment: str = Field(default="development", alias="ENVIRONMENT")
    public_app_url: str = Field(default="http://localhost:8000", alias="PUBLIC_APP_URL")

    # ------------------------------------------------------------------ AI
    # Production provider is Google Gemini (native REST API).
    ai_provider: str = Field(default="gemini", alias="AI_PROVIDER")  # "gemini" | "openai_compatible"
    gemini_api_key: str = Field(
        default="",
        validation_alias=_alias("GEMINI_API_KEY", "OPENCODE_API_KEY"),
    )
    gemini_base_url: str = Field(
        default="https://generativelanguage.googleapis.com/v1beta",
        validation_alias=_alias("GEMINI_BASE_URL", "OPENCODE_BASE_URL"),
    )
    gemini_model_main: str = Field(
        default="gemini-3.8-flash",
        validation_alias=_alias("GEMINI_MODEL_MAIN", "OPENCODE_MODEL"),
    )
    gemini_model_fast: str = Field(
        default="gemini-3.5-flash-lite",
        validation_alias=_alias("GEMINI_MODEL_FAST", "OPENCODE_FAST_MODEL"),
    )
    gemini_timeout_seconds: float = Field(
        default=240.0, validation_alias=_alias("GEMINI_TIMEOUT_SECONDS", "OPENCODE_TIMEOUT_SECONDS")
    )
    gemini_connect_timeout_seconds: float = Field(
        default=15.0, alias="GEMINI_CONNECT_TIMEOUT_SECONDS"
    )
    gemini_max_concurrency: int = Field(
        default=6, validation_alias=_alias("GEMINI_MAX_CONCURRENCY", "OPENCODE_MAX_CONCURRENCY")
    )
    ai_temperature: float = Field(default=0.2, alias="AI_TEMPERATURE")
    ai_max_output_tokens: int = Field(default=8192, alias="AI_MAX_OUTPUT_TOKENS")
    ai_hard_max_output_tokens: int = Field(default=16_000, alias="AI_HARD_MAX_OUTPUT_TOKENS")
    ai_max_retries: int = Field(default=2, alias="AI_MAX_RETRIES")
    ai_preflight_enabled: bool = Field(default=True, alias="AI_PREFLIGHT_ENABLED")
    trust_client_transcripts: bool = Field(default=True, alias="TRUST_CLIENT_TRANSCRIPTS")
    # USD per 1M tokens; defaults are illustrative placeholders and should be
    # set per deployment. Set to 0 to disable cost estimation.
    ai_price_main_input: float = Field(default=0.0, alias="AI_PRICE_MAIN_INPUT")
    ai_price_main_output: float = Field(default=0.0, alias="AI_PRICE_MAIN_OUTPUT")
    ai_price_fast_input: float = Field(default=0.0, alias="AI_PRICE_FAST_INPUT")
    ai_price_fast_output: float = Field(default=0.0, alias="AI_PRICE_FAST_OUTPUT")

    # ------------------------------------------------------------ supabase
    supabase_url: str = Field(default="", alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(default="", alias="SUPABASE_SERVICE_ROLE_KEY")
    supabase_anon_key: str = Field(default="", alias="SUPABASE_ANON_KEY")
    # Legacy HS256 JWT secret (only needed when the project signs tokens with a
    # shared secret; new projects use asymmetric JWKS which we verify via /auth/v1).
    supabase_jwt_secret: str = Field(default="", alias="SUPABASE_JWT_SECRET")
    supabase_jwks_url: str = Field(default="", alias="SUPABASE_JWKS_URL")
    # "auto" -> Supabase when configured, otherwise filesystem (dev only).
    storage_backend: str = Field(default="auto", alias="STORAGE_BACKEND")

    # ----------------------------------------------------------- razorpay
    razorpay_key_id: str = Field(default="", alias="RAZORPAY_KEY_ID")
    razorpay_key_secret: str = Field(default="", alias="RAZORPAY_KEY_SECRET")
    razorpay_webhook_secret: str = Field(default="", alias="RAZORPAY_WEBHOOK_SECRET")
    razorpay_currency: str = Field(default="INR", alias="RAZORPAY_CURRENCY")
    razorpay_plan_amount: int = Field(
        default=49_900, alias="RAZORPAY_PLAN_AMOUNT"
    )  # smallest currency unit (paise)
    razorpay_plan_name: str = Field(default="YouTube AI Reader Pro", alias="RAZORPAY_PLAN_NAME")
    razorpay_plan_period_days: int = Field(default=30, alias="RAZORPAY_PLAN_PERIOD_DAYS")

    # --------------------------------------------------------------- auth
    # When false (development/test) requests without a JWT fall back to the
    # anonymous install id. Production must be true.
    auth_required: bool = Field(default=False, alias="AUTH_REQUIRED")

    # -------------------------------------------------------------- server
    host: str = Field(default="127.0.0.1", alias="HOST")
    port: int = Field(default=8000, alias="PORT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    data_dir: Path = Field(default=BACKEND_DIR / "data", alias="DATA_DIR")
    cors_allow_origins: str = Field(default="", alias="CORS_ALLOW_ORIGINS")
    cors_allow_origin_regex: str = Field(
        default=(
            r"^(chrome-extension://.*|http://localhost(:\d+)?|http://127\.0\.0\.1(:\d+)?)$"
        ),
        alias="CORS_ALLOW_ORIGIN_REGEX",
    )
    trust_proxy: bool = Field(default=False, alias="TRUST_PROXY")
    log_poll_requests: bool = Field(default=False, alias="LOG_POLL_REQUESTS")

    # --------------------------------------------------------- processing
    ytdlp_timeout_seconds: float = Field(default=180.0, alias="YTDLP_TIMEOUT_SECONDS")
    ytdlp_max_retries: int = Field(default=2, alias="YTDLP_MAX_RETRIES")
    ytdlp_concurrency: int = Field(default=1, alias="YTDLP_CONCURRENCY")
    ytdlp_min_interval_seconds: float = Field(default=4.0, alias="YTDLP_MIN_INTERVAL_SECONDS")
    ytdlp_429_max_retries: int = Field(default=1, alias="YTDLP_429_MAX_RETRIES")
    ytdlp_429_backoff_seconds: float = Field(default=8.0, alias="YTDLP_429_BACKOFF_SECONDS")
    ytdlp_cookies_file: str = Field(default="", alias="YTDLP_COOKIES_FILE")
    ytdlp_cookies_from_browser: str = Field(default="", alias="YTDLP_COOKIES_FROM_BROWSER")
    ytdlp_player_client: str = Field(default="", alias="YTDLP_PLAYER_CLIENT")
    transcript_fallback_enabled: bool = Field(default=True, alias="TRANSCRIPT_FALLBACK_ENABLED")
    max_transcript_chars: int = Field(default=900_000, alias="MAX_TRANSCRIPT_CHARS")
    max_chat_message_chars: int = Field(default=2_000, alias="MAX_CHAT_MESSAGE_CHARS")
    max_concurrent_jobs: int = Field(default=3, alias="MAX_CONCURRENT_JOBS")
    job_queue_timeout_seconds: float = Field(default=45.0, alias="JOB_QUEUE_TIMEOUT_SECONDS")
    cache_enabled: bool = Field(default=True, alias="CACHE_ENABLED")
    prompt_version: int = Field(default=1, alias="PROMPT_VERSION")

    # --------------------------------------------------------- quotas
    free_video_limit: int = Field(default=3, alias="FREE_VIDEO_LIMIT")
    free_monthly_video_limit: int = Field(default=5, alias="FREE_MONTHLY_VIDEO_LIMIT")
    free_monthly_chat_limit: int = Field(default=200, alias="FREE_MONTHLY_CHAT_LIMIT")
    usage_enabled: bool = Field(default=True, alias="USAGE_ENABLED")
    quota_enabled: bool = Field(default=True, alias="QUOTA_ENABLED")

    # ------------------------------------------------------- rate limits
    rate_limit_process_per_hour: int = Field(default=10, alias="RATE_LIMIT_PROCESS_PER_HOUR")
    rate_limit_chat_per_hour: int = Field(default=60, alias="RATE_LIMIT_CHAT_PER_HOUR")
    rate_limit_general_per_minute: int = Field(
        default=240, alias="RATE_LIMIT_GENERAL_PER_MINUTE"
    )

    # ------------------------------------------------------ analysis size
    chunk_target_chars: int = Field(default=1200, alias="CHUNK_TARGET_CHARS")
    chunk_max_chars: int = Field(default=1800, alias="CHUNK_MAX_CHARS")
    chunk_max_duration_seconds: float = Field(default=120.0, alias="CHUNK_MAX_DURATION_SECONDS")
    overview_context_chars: int = Field(default=14_000, alias="OVERVIEW_CONTEXT_CHARS")
    analysis_reading_concurrency: int = Field(
        default=4, alias="ANALYSIS_READING_CONCURRENCY"
    )
    max_reading_sections: int = Field(default=8, alias="MAX_READING_SECTIONS")
    reading_section_chars: int = Field(default=10_000, alias="READING_SECTION_CHARS")
    chat_top_k: int = Field(default=6, alias="CHAT_TOP_K")
    chat_context_chars: int = Field(default=12_000, alias="CHAT_CONTEXT_CHARS")
    chat_history_turns: int = Field(default=8, alias="CHAT_HISTORY_TURNS")

    # ------------------------------------------------------------ paths
    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache" / "videos"

    @property
    def usage_dir(self) -> Path:
        return self.data_dir / "usage"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]

    @property
    def ai_configured(self) -> bool:
        return bool(self.gemini_api_key)

    @property
    def effective_fast_model(self) -> str:
        """Model used for cheap work; falls back to the main model."""
        return self.gemini_model_fast or self.gemini_model_main

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def use_supabase_storage(self) -> bool:
        if self.storage_backend == "filesystem":
            return False
        if self.storage_backend == "supabase":
            return True
        return self.supabase_configured

    @property
    def razorpay_configured(self) -> bool:
        return bool(self.razorpay_key_id and self.razorpay_key_secret)

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in ("production", "prod")

    # ------------------------------------------------- backward-compatible
    # Existing code and local .env files still use the OPENCODE_* names.
    @property
    def opencode_api_key(self) -> str:
        return self.gemini_api_key

    @opencode_api_key.setter
    def opencode_api_key(self, value: str) -> None:
        self.gemini_api_key = value

    @property
    def opencode_base_url(self) -> str:
        return self.gemini_base_url

    @property
    def opencode_model(self) -> str:
        return self.gemini_model_main

    @opencode_model.setter
    def opencode_model(self, value: str) -> None:
        self.gemini_model_main = value

    @property
    def opencode_fast_model(self) -> str:
        return self.gemini_model_fast

    @opencode_fast_model.setter
    def opencode_fast_model(self, value: str) -> None:
        self.gemini_model_fast = value

    @property
    def opencode_timeout_seconds(self) -> float:
        return self.gemini_timeout_seconds

    @property
    def opencode_max_concurrency(self) -> int:
        return self.gemini_max_concurrency


@lru_cache
def get_settings() -> Settings:
    return Settings(_env_file=str(BACKEND_DIR / ".env"), _env_file_encoding="utf-8")
