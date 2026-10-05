"""Transcript acquisition via yt-dlp, with a fallback caption provider.

``TranscriptProvider`` is the seam for transcription backends. The default
implementation uses yt-dlp (subtitle files only — never video media) and is
deliberately gentle with YouTube:

* one yt-dlp invocation fetches metadata *and* captions in the common case;
* a request gate serialises YouTube calls and spaces them out;
* HTTP 429s trigger exponential backoff with a shared cooldown;
* optional cookies reduce throttling;
* if yt-dlp's caption download is throttled, ``youtube-transcript-api`` is used
  as a fallback caption source.

All subprocess calls use argument arrays (no shell).
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import sys
import tempfile
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.config import Settings
from app.errors import (
    AgeRestricted,
    TranscriptProcessingError,
    TranscriptUnavailable,
    VideoUnavailable,
    YouTubeRateLimited,
    YtDlpFailure,
)
from app.models.schemas import Chapter, SubtitleKind, Transcript, TranscriptSegment, VideoMeta
from app.services.subtitles import normalize_segments, parse_subtitle_content
from app.services.youtube import canonical_watch_url
from app.utils.text import clean_text

logger = logging.getLogger("youtube_ai_reader.transcript")

_PREFERRED_LANGS = ("en", "en-US", "en-GB", "en-orig")
_SUBTITLE_SUFFIXES = (".json3", ".vtt", ".srt", ".ttml", ".xml")
_SUBTITLE_PREFERENCE = {suffix: index for index, suffix in enumerate(_SUBTITLE_SUFFIXES)}
_BOT_CHECK_MARKERS = (
    "sign in to confirm you're not a bot",
    "sign in to confirm you’re not a bot",
    "confirm you're not a bot",
)
_AGE_MARKERS = ("age-restricted", "sign in to confirm your age", "age restricted")
_PRIVATE_MARKERS = ("private video", "video is private")
_UNAVAILABLE_MARKERS = (
    "video unavailable",
    "this video is not available",
    "removed by the uploader",
    "no longer available",
)
_RATE_LIMIT_MARKERS = ("429", "too many requests", "rate limit", "rate-limit")


@dataclass
class TranscriptResult:
    meta: VideoMeta
    transcript: Transcript


def _is_rate_limited(text: str) -> bool:
    lowered = (text or "").lower()
    return any(marker in lowered for marker in _RATE_LIMIT_MARKERS)


class _RequestGate:
    """Serialises YouTube requests and enforces a minimum spacing + cooldown."""

    def __init__(self, concurrency: int, min_interval: float) -> None:
        self._semaphore = asyncio.Semaphore(max(1, concurrency))
        self._min_interval = max(0.0, min_interval)
        self._next_allowed = 0.0
        self._cooldown_until = 0.0

    async def __aenter__(self) -> "_RequestGate":
        await self._semaphore.acquire()
        now = time.monotonic()
        wait = max(self._next_allowed, self._cooldown_until) - now
        if wait > 0:
            await asyncio.sleep(wait)
        self._next_allowed = time.monotonic() + self._min_interval
        return self

    async def __aexit__(self, *_exc: object) -> None:
        self._semaphore.release()

    def cooldown(self, seconds: float) -> None:
        self._cooldown_until = max(self._cooldown_until, time.monotonic() + seconds)


class TranscriptProvider(ABC):
    """Fetches metadata + a timestamped transcript for a validated video id."""

    @abstractmethod
    async def fetch(self, video_id: str) -> TranscriptResult:
        ...


class TranscriptUnavailableProvider(TranscriptProvider):
    """Explicit no-op provider; useful for tests and future pipeline swaps."""

    async def fetch(self, video_id: str) -> TranscriptResult:  # pragma: no cover
        raise TranscriptUnavailable()


class YtDlpTranscriptProvider(TranscriptProvider):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._gate = _RequestGate(
            settings.ytdlp_concurrency, settings.ytdlp_min_interval_seconds
        )

    # ------------------------------------------------------------- public

    async def fetch(self, video_id: str) -> TranscriptResult:
        url = canonical_watch_url(video_id)
        started = time.monotonic()
        logger.info("[video] fetching metadata id=%s", video_id)

        # Fetch oEmbed metadata in parallel so a throttled yt-dlp still yields a title.
        meta_task = asyncio.create_task(self._fallback_metadata(video_id))
        rate_limited = False
        try:
            info, segments, lang, kind, rate_limited = await self._fetch_combined(video_id, url)
            self._assert_playable(info)
            meta = self._build_meta(video_id, info)
        except YouTubeRateLimited:
            logger.warning("[transcript] yt-dlp throttled; using fallback sources id=%s", video_id)
            meta = await meta_task
            if meta is None:
                raise
            segments = await self._fallback_segments(video_id, list(_PREFERRED_LANGS))
            if not segments:
                raise
            lang, kind = "en", "auto"
            meta.language = lang
            meta.subtitle_kind = kind
            logger.info(
                "[transcript] fallback produced %d segments id=%s", len(segments), video_id
            )
            return TranscriptResult(
                meta=meta,
                transcript=Transcript(
                    video_id=video_id, language=lang, kind=kind, segments=segments
                ),
            )
        finally:
            if not meta_task.done():
                meta_task.cancel()

        logger.info(
            "[transcript] metadata ok id=%s title=%r fetch=%.1fs",
            video_id,
            (meta.title or "")[:60],
            time.monotonic() - started,
        )

        if segments is None:
            chosen_lang, chosen_kind = self._pick_subtitle_track(info)
            if chosen_lang and not rate_limited:
                logger.info("[transcript] downloading %s captions lang=%s", chosen_kind, chosen_lang)
                try:
                    segments = await self._download_subtitles(
                        url, video_id, chosen_lang, chosen_kind
                    )
                    lang, kind = chosen_lang, chosen_kind
                except YouTubeRateLimited:
                    logger.warning(
                        "[transcript] caption download throttled; trying fallback provider id=%s",
                        video_id,
                    )
            if segments is None:
                fallback_langs = [chosen_lang] if chosen_lang else list(_PREFERRED_LANGS)
                segments = await self._fallback_segments(video_id, fallback_langs)
                if segments is not None:
                    lang = chosen_lang or "en"
                    kind = chosen_kind or "auto"

        if not segments:
            raise TranscriptUnavailable()

        logger.info(
            "[transcript] %d segments, %d characters, kind=%s lang=%s in %.1fs",
            len(segments),
            sum(len(s.text) for s in segments),
            kind,
            lang,
            time.monotonic() - started,
        )
        transcript = Transcript(video_id=video_id, language=lang, kind=kind, segments=segments)
        meta.language = lang
        meta.subtitle_kind = kind
        return TranscriptResult(meta=meta, transcript=transcript)

    # ---------------------------------------------------------- yt-dlp io

    def _base_args(self) -> list[str]:
        args = [
            sys.executable,
            "-m",
            "yt_dlp",
            "--no-playlist",
            "--no-warnings",
            "--no-progress",
            "--socket-timeout",
            "20",
            "--retries",
            str(max(0, self.settings.ytdlp_max_retries)),
            "--sleep-requests",
            "1",
        ]
        if self.settings.ytdlp_cookies_file:
            args += ["--cookies", self.settings.ytdlp_cookies_file]
        if self.settings.ytdlp_cookies_from_browser:
            args += ["--cookies-from-browser", self.settings.ytdlp_cookies_from_browser]
        if self.settings.ytdlp_player_client:
            args += [
                "--extractor-args",
                f"youtube:player_client={self.settings.ytdlp_player_client}",
            ]
        return args

    async def _run_ytdlp(self, args: list[str], timeout: float) -> tuple[int, str, str]:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(process.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise YtDlpFailure("Fetching this video timed out. Please try again.") from None
        except asyncio.CancelledError:
            process.kill()
            await process.wait()
            raise
        return (
            process.returncode or 0,
            stdout_b.decode("utf-8", errors="replace"),
            stderr_b.decode("utf-8", errors="replace"),
        )

    async def _run_ytdlp_with_retry(
        self, args: list[str], timeout: float
    ) -> tuple[int, str, str]:
        """Run yt-dlp through the gate, backing off on HTTP 429."""
        max_retries = max(0, self.settings.ytdlp_429_max_retries)
        base = max(1.0, self.settings.ytdlp_429_backoff_seconds)
        last: tuple[int, str, str] = (0, "", "")
        for attempt in range(max_retries + 1):
            async with self._gate:
                last = await self._run_ytdlp(args, timeout)
            code, _stdout, stderr = last
            if code == 0 or not _is_rate_limited(stderr):
                return last
            if attempt >= max_retries:
                break
            backoff = base * (2**attempt) + random.uniform(0, base / 2)
            self._gate.cooldown(backoff)
            logger.warning(
                "[transcript] YouTube rate limited (attempt %d/%d); backing off %.0fs",
                attempt + 1,
                max_retries,
                backoff,
            )
            await asyncio.sleep(backoff)
        # Exhausted retries: hold off all YouTube requests for a while.
        self._gate.cooldown(max(60.0, base))
        return last

    async def _fetch_combined(
        self, video_id: str, url: str
    ) -> tuple[
        dict[str, Any], list[TranscriptSegment] | None, str | None, SubtitleKind, bool
    ]:
        """Fetch metadata and (preferred) captions in a single yt-dlp call.

        Returns ``(info, segments, lang, kind, rate_limited)``.
        """
        with tempfile.TemporaryDirectory(prefix="yair-subs-") as tmp:
            args = self._base_args() + [
                "--skip-download",
                "--write-info-json",
                "--write-subs",
                "--write-auto-subs",
                "--sub-format",
                "json3/vtt/best",
                "--sub-langs",
                "en.*,en",
                "-o",
                str(Path(tmp) / "%(id)s.%(ext)s"),
                url,
            ]
            code, _stdout, stderr = await self._run_ytdlp_with_retry(
                args, self.settings.ytdlp_timeout_seconds
            )
            info = self._read_info_json(tmp, video_id)
            if info is None:
                if code != 0:
                    raise _map_ytdlp_error(stderr)
                raise YtDlpFailure("The video service returned unreadable data.")

            throttled = _is_rate_limited(stderr)
            subtitle = self._find_subtitle(tmp, video_id)
            if subtitle is None:
                if code != 0 and not throttled:
                    message = stderr.lower()
                    if not any(
                        marker in message
                        for marker in ("no subtitle", "there are no subtitles", "no captions")
                    ):
                        logger.info("[transcript] no caption file produced id=%s", video_id)
                return info, None, None, "none", throttled

            lang, kind = self._describe_subtitle(subtitle, video_id, info)
            try:
                raw = subtitle.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                raise TranscriptProcessingError() from exc
            segments = normalize_segments(parse_subtitle_content(raw, subtitle.suffix))
            if not segments:
                return info, None, None, "none", throttled
            return info, segments, lang, kind, throttled

    async def _download_subtitles(
        self, url: str, video_id: str, lang: str, kind: SubtitleKind
    ) -> list[TranscriptSegment]:
        with tempfile.TemporaryDirectory(prefix="yair-subs-") as tmp:
            args = self._base_args() + [
                "--skip-download",
                "--sub-format",
                "json3/vtt/best",
                "--sub-langs",
                lang,
                "-o",
                str(Path(tmp) / "%(id)s.%(ext)s"),
            ]
            args.append("--write-subs" if kind == "manual" else "--write-auto-subs")
            args.append(url)
            code, _stdout, stderr = await self._run_ytdlp_with_retry(
                args, self.settings.ytdlp_timeout_seconds
            )
            subtitle = self._find_subtitle(tmp, video_id)
            if subtitle is None:
                if _is_rate_limited(stderr):
                    raise YouTubeRateLimited()
                if code != 0:
                    raise _map_ytdlp_error(stderr)
                raise TranscriptUnavailable("Couldn't obtain a transcript for this video.")
            try:
                raw = subtitle.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                raise TranscriptProcessingError() from exc
            segments = normalize_segments(parse_subtitle_content(raw, subtitle.suffix))
            if not segments:
                raise TranscriptUnavailable()
            return segments

    async def _fallback_segments(
        self, video_id: str, languages: list[str] | None
    ) -> list[TranscriptSegment] | None:
        if not self.settings.transcript_fallback_enabled:
            return None
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
        except ImportError:  # pragma: no cover - optional dependency
            logger.info("[transcript] fallback provider not installed")
            return None

        langs = [lang for lang in (languages or _PREFERRED_LANGS) if lang]

        def _blocking_fetch() -> list[tuple[float, float, str]]:
            fetched = YouTubeTranscriptApi().fetch(video_id, languages=tuple(langs))
            return [
                (float(item.start), float(getattr(item, "duration", 0) or 0), item.text)
                for item in fetched
            ]

        try:
            raw = await asyncio.to_thread(_blocking_fetch)
        except Exception as exc:  # noqa: BLE001 - fallback is best-effort
            logger.warning(
                "[transcript] fallback provider failed id=%s: %s: %s",
                video_id,
                type(exc).__name__,
                str(exc)[:160],
            )
            return None

        segments = [
            TranscriptSegment(
                start=start,
                end=start + max(duration, 0.3),
                text=clean_text(text),
            )
            for start, duration, text in raw
            if text and text.strip()
        ]
        normalized = normalize_segments(segments)
        return normalized or None

    async def _fallback_metadata(self, video_id: str) -> VideoMeta | None:
        """oEmbed metadata used when yt-dlp cannot extract anything."""
        watch_url = canonical_watch_url(video_id)
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(
                    "https://www.youtube.com/oembed",
                    params={"url": watch_url, "format": "json"},
                )
                response.raise_for_status()
                data = response.json()
        except Exception as exc:  # noqa: BLE001 - fallback is best-effort
            logger.warning(
                "[transcript] oEmbed fallback failed id=%s: %s", video_id, type(exc).__name__
            )
            return None
        return VideoMeta(
            video_id=video_id,
            url=watch_url,
            title=str(data.get("title") or "Untitled video"),
            channel=data.get("author_name"),
            thumbnail=data.get("thumbnail_url"),
        )

    # ----------------------------------------------------------- helpers

    @staticmethod
    def _read_info_json(tmp: str, video_id: str) -> dict[str, Any] | None:
        path = Path(tmp) / f"{video_id}.info.json"
        if not path.exists():
            return None
        try:
            with path.open("r", encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, json.JSONDecodeError):
            return None

    @staticmethod
    def _find_subtitle(tmp: str, video_id: str) -> Path | None:
        candidates = [
            path
            for path in Path(tmp).iterdir()
            if path.name.startswith(f"{video_id}.")
            and path.suffix.lower() in _SUBTITLE_SUFFIXES
        ]
        if not candidates:
            return None
        candidates.sort(key=lambda path: _SUBTITLE_PREFERENCE.get(path.suffix.lower(), 99))
        return candidates[0]

    @staticmethod
    def _describe_subtitle(
        path: Path, video_id: str, info: dict[str, Any]
    ) -> tuple[str, SubtitleKind]:
        name = path.name
        prefix = f"{video_id}."
        lang = name[len(prefix) : -len(path.suffix)] if name.startswith(prefix) else "en"
        manual = info.get("subtitles") or {}
        auto = info.get("automatic_captions") or {}
        if _lang_in(lang, manual):
            return lang, "manual"
        if _lang_in(lang, auto):
            return lang, "auto"
        return lang, "auto"

    def _assert_playable(self, info: dict[str, Any]) -> None:
        if info.get("is_live"):
            raise VideoUnavailable("Live streams aren't supported yet.")
        availability = str(info.get("availability") or "")
        if availability in ("private", "premium_only", "subscriber_only"):
            raise VideoUnavailable()
        if info.get("_type") == "playlist":  # pragma: no cover - defensive
            raise VideoUnavailable("Expected a single video but got a playlist.")

    def _build_meta(self, video_id: str, info: dict[str, Any]) -> VideoMeta:
        thumbnails = info.get("thumbnails") or []
        thumbnail = thumbnails[-1].get("url") if thumbnails else None
        if not thumbnail:
            thumbnail = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
        duration = info.get("duration")
        creator_chapters = None
        if info.get("chapters"):
            creator_chapters = []
            for chapter in info["chapters"]:
                try:
                    creator_chapters.append(
                        Chapter(
                            title=str(chapter.get("title") or "Chapter"),
                            start_seconds=float(chapter.get("start_time") or 0),
                            end_seconds=(
                                float(chapter["end_time"])
                                if chapter.get("end_time") is not None
                                else None
                            ),
                        )
                    )
                except (TypeError, ValueError):
                    continue
        return VideoMeta(
            video_id=video_id,
            url=f"https://www.youtube.com/watch?v={video_id}",
            title=str(info.get("title") or "Untitled video"),
            channel=info.get("channel") or info.get("uploader"),
            duration=float(duration) if isinstance(duration, (int, float)) else None,
            thumbnail=thumbnail,
            creator_chapters=creator_chapters,
        )

    def _pick_subtitle_track(self, info: dict[str, Any]) -> tuple[str | None, SubtitleKind]:
        manual: dict[str, Any] = info.get("subtitles") or {}
        auto: dict[str, Any] = info.get("automatic_captions") or {}
        for lang in _PREFERRED_LANGS:
            if lang in manual:
                return lang, "manual"
        if manual:
            return sorted(manual.keys())[0], "manual"
        for lang in _PREFERRED_LANGS:
            if lang in auto:
                return lang, "auto"
        if auto:
            candidate = sorted(auto.keys())[0]
            if candidate != "live_chat":
                return candidate, "auto"
        return None, "none"


def _lang_in(lang: str, tracks: dict[str, Any]) -> bool:
    if lang in tracks:
        return True
    base = lang.split("-")[0]
    return any(key == base or key.split("-")[0] == base for key in tracks)


def _map_ytdlp_error(stderr: str) -> Exception:
    message = (stderr or "").strip()
    lowered = message.lower()
    if _is_rate_limited(lowered):
        return YouTubeRateLimited()
    if any(marker in lowered for marker in _BOT_CHECK_MARKERS):
        return YtDlpFailure(
            "YouTube blocked the request from this server (bot check). "
            "Try again later, set YTDLP_COOKIES_FILE, or update yt-dlp."
        )
    if any(marker in lowered for marker in _AGE_MARKERS):
        return AgeRestricted()
    if any(marker in lowered for marker in _PRIVATE_MARKERS):
        return VideoUnavailable("This video is private.")
    if any(marker in lowered for marker in _UNAVAILABLE_MARKERS):
        return VideoUnavailable()
    tail = message.splitlines()[-1] if message else "yt-dlp failed"
    return YtDlpFailure(f"Couldn't fetch this video: {tail[:200]}")
