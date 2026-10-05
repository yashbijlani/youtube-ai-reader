"""Domain error types mapped to friendly HTTP responses."""

from __future__ import annotations


class AppError(Exception):
    """A handled error with a stable machine code and a human message."""

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class InvalidYouTubeUrl(AppError):
    def __init__(self, message: str = "That doesn't look like a YouTube video URL.") -> None:
        super().__init__("invalid_youtube_url", message, 400)


class VideoNotFound(AppError):
    def __init__(self, message: str = "This video could not be found. It may be deleted or private.") -> None:
        super().__init__("video_not_found", message, 404)


class VideoUnavailable(AppError):
    def __init__(self, message: str = "This video is unavailable (deleted, private, or region-locked).") -> None:
        super().__init__("video_unavailable", message, 422)


class AgeRestricted(AppError):
    def __init__(self, message: str = "This video is age-restricted, so its transcript cannot be fetched.") -> None:
        super().__init__("age_restricted", message, 422)


class TranscriptUnavailable(AppError):
    def __init__(self, message: str = "Couldn't obtain a transcript for this video.") -> None:
        super().__init__("transcript_unavailable", message, 422)


class YouTubeRateLimited(AppError):
    def __init__(self, retry_after: int = 60) -> None:
        self.retry_after = retry_after
        super().__init__(
            "youtube_rate_limited",
            "YouTube is temporarily rate-limiting transcript downloads from this server. "
            f"Please try again in about {max(1, retry_after)} seconds.",
            503,
        )


class TranscriptTooLarge(AppError):
    def __init__(self, message: str = "This video's transcript is too large to process.") -> None:
        super().__init__("transcript_too_large", message, 413)


class TranscriptProcessingError(AppError):
    def __init__(self, message: str = "The transcript could not be processed.") -> None:
        super().__init__("transcript_processing_error", message, 500)


class YtDlpFailure(AppError):
    def __init__(self, message: str = "The video service failed while fetching this video.") -> None:
        super().__init__("ytdlp_failure", message, 502)


class AIProviderError(AppError):
    # ``terminal`` errors won't succeed on retry (bad key, no funds, missing model).
    terminal = False

    def __init__(self, message: str = "The AI service failed to respond.", *, terminal: bool = False) -> None:
        super().__init__("ai_provider_error", message, 502)
        self.terminal = terminal


class AIFundingError(AIProviderError):
    def __init__(
        self,
        message: str = (
            "Your AI provider account has insufficient funds, or this model isn't "
            "available to API keys. Enable extra usage / add credit, or switch provider."
        ),
    ) -> None:
        super().__init__(message, terminal=True)
        self.code = "ai_insufficient_funds"
        self.status_code = 402


class AIAccessDenied(AIProviderError):
    def __init__(
        self,
        message: str = (
            "The AI provider denied the request (invalid key, or this model isn't "
            "available to API keys). Check the key and model."
        ),
    ) -> None:
        super().__init__(message, terminal=True)
        self.code = "ai_access_denied"
        self.status_code = 403


class AIModelUnavailable(AIProviderError):
    def __init__(self, model: str) -> None:
        super().__init__(
            f"The configured model '{model}' is not available to this API key.",
            terminal=True,
        )
        self.code = "ai_model_unavailable"
        self.status_code = 404


class AIProviderNotConfigured(AppError):
    def __init__(self) -> None:
        super().__init__(
            "ai_not_configured",
            "The AI service is not configured. Set OPENCODE_API_KEY on the backend.",
            503,
        )


class AIOutputError(AppError):
    def __init__(self, message: str = "The AI service returned output that could not be parsed.") -> None:
        super().__init__("malformed_ai_output", message, 502)


class VideoNotProcessed(AppError):
    def __init__(self, video_id: str) -> None:
        super().__init__(
            "video_not_processed",
            f"Video {video_id} has not been processed yet.",
            404,
        )


class ProcessingInProgress(AppError):
    def __init__(self) -> None:
        super().__init__("processing_in_progress", "This video is still being processed.", 409)


class RateLimited(AppError):
    def __init__(self, message: str = "Too many requests. Please slow down and try again shortly.") -> None:
        super().__init__("rate_limited", message, 429)


class ServerBusy(AppError):
    def __init__(self) -> None:
        super().__init__(
            "server_busy",
            "The server is busy processing other videos. Please try again in a moment.",
            503,
        )


class FreeLimitReached(AppError):
    def __init__(self, limit: int, remaining: int = 0) -> None:
        super().__init__(
            "free_limit_reached",
            f"You've used all {limit} free videos. Upgrade to Pro for unlimited reading.",
            402,
        )
        self.limit = limit
        self.remaining = remaining


class Unauthorized(AppError):
    def __init__(self, message: str = "Please sign in to continue.") -> None:
        super().__init__("unauthorized", message, 401)


class Forbidden(AppError):
    def __init__(self, message: str = "You don't have access to this resource.") -> None:
        super().__init__("forbidden", message, 403)


class SubscriptionRequired(AppError):
    def __init__(self, message: str = "An active subscription is required for this action.") -> None:
        super().__init__("subscription_required", message, 402)


class QuotaExceeded(AppError):
    def __init__(self, message: str = "You've reached your usage limit. Upgrade for more.") -> None:
        super().__init__("quota_exceeded", message, 402)
