"""Application configuration.

All secrets and tunables come from environment variables (or a local .env file).
The OpenCode API key is only ever read here, on the server.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        extra="ignore",
        case_sensitive=False,
    )

    # ------------------------------------------------------------------ AI
    opencode_api_key: str = Field(default="", alias="OPENCODE_API_KEY")
    opencode_base_url: str = Field(
        default="https://opencode.ai/zen/v1", alias="OPENCODE_BASE_URL"
    )
    opencode_model: str = Field(default="deepseek-v4.1-flash", alias="OPENCODE_MODEL")
    opencode_fast_model: str = Field(default="", alias="OPENCODE_FAST_MODEL")
    opencode_timeout_seconds: float = Field(default=240.0, alias="OPENCODE_TIMEOUT_SECONDS")
    opencode_connect_timeout_seconds: float = Field(
        default=15.0, alias="OPENCODE_CONNECT_TIMEOUT_SECONDS"
    )
    opencode_max_concurrency: int = Field(default=6, alias="OPENCODE_MAX_CONCURRENCY")
    ai_temperature: float = Field(default=0.2, alias="AI_TEMPERATURE")
    ai_max_output_tokens: int = Field(default=8192, alias="AI_MAX_OUTPUT_TOKENS")
    ai_hard_max_output_tokens: int = Field(default=16_000, alias="AI_HARD_MAX_OUTPUT_TOKENS")
    ai_max_retries: int = Field(default=2, alias="AI_MAX_RETRIES")
    ai_preflight_enabled: bool = Field(default=True, alias="AI_PREFLIGHT_ENABLED")
    trust_client_transcripts: bool = Field(default=True, alias="TRUST_CLIENT_TRANSCRIPTS")

    # -------------------------------------------------------------- server
    host: str = Field(default="127.0.0.1", alias="HOST")
    port: int = Field(default=8000, alias="PORT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    data_dir: Path = Field(default=BACKEND_DIR / "data", alias="DATA_DIR")
    cors_allow_origins: str = Field(default="", alias="CORS_ALLOW_ORIGINS")
    cors_allow_origin_regex: str = Field(
        default=r"^(chrome-extension://.*|http://localhost(:\d+)?|http://127\.0\.0\.1(:\d+)?)$",
        alias="CORS_ALLOW_ORIGIN_REGEX",
    )
    trust_proxy: bool = Field(default=False, alias="TRUST_PROXY")
    log_poll_requests: bool = Field(default=False, alias="LOG_POLL_REQUESTS")

    # --------------------------------------------------------- processing
    ytdlp_timeout_seconds: float = Field(default=180.0, alias="YTDLP_TIMEOUT_SECONDS")
    ytdlp_max_retries: int = Field(default=2, alias="YTDLP_MAX_RETRIES")
    # YouTube-facing request pacing (separate from the client-facing rate limits).
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
    free_video_limit: int = Field(default=3, alias="FREE_VIDEO_LIMIT")
    usage_enabled: bool = Field(default=True, alias="USAGE_ENABLED")

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
        return bool(self.opencode_api_key)

    @property
    def effective_fast_model(self) -> str:
        """Model used for map/summary/chapter work; falls back to the main model."""
        return self.opencode_fast_model or self.opencode_model


@lru_cache
def get_settings() -> Settings:
    return Settings(_env_file=str(BACKEND_DIR / ".env"), _env_file_encoding="utf-8")
