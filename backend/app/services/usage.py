"""Per-install usage tracking for the free preview limit.

No accounts: the extension sends a stable random ``X-Install-Id`` and we count
the distinct videos it has processed. Paid status is recorded best-effort via
``/api/entitlement`` (client-gated, as agreed). Swapping this for a real
database later means reimplementing this small interface.
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from app.config import Settings

logger = logging.getLogger("youtube_ai_reader.usage")

_INSTALL_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


@dataclass
class UsageRecord:
    videos: list[str] = field(default_factory=list)
    paid: bool = False
    email: str | None = None
    updated_at: str | None = None


class UsageStore:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.enabled = settings.usage_enabled
        self.limit = settings.free_video_limit
        if self.enabled:
            self.settings.usage_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def valid_install_id(install_id: str | None) -> bool:
        return bool(install_id and _INSTALL_RE.match(install_id))

    def _path(self, install_id: str) -> Path:
        if not self.valid_install_id(install_id):
            raise ValueError("unsafe install id")
        return self.settings.usage_dir / f"{install_id}.json"

    def get(self, install_id: str) -> UsageRecord:
        if not self.enabled or not self.valid_install_id(install_id):
            return UsageRecord()
        path = self._path(install_id)
        if not path.exists():
            return UsageRecord()
        try:
            with path.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
            return UsageRecord(
                videos=list(data.get("videos") or []),
                paid=bool(data.get("paid")),
                email=data.get("email"),
                updated_at=data.get("updated_at"),
            )
        except (OSError, json.JSONDecodeError):
            logger.warning("[usage] corrupt record install=%s", install_id[:8])
            return UsageRecord()

    def _write(self, install_id: str, record: UsageRecord) -> None:
        if not self.enabled or not self.valid_install_id(install_id):
            return
        record.updated_at = datetime.now(timezone.utc).isoformat()
        directory = self.settings.usage_dir
        directory.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=directory, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(
                    {
                        "videos": record.videos,
                        "paid": record.paid,
                        "email": record.email,
                        "updated_at": record.updated_at,
                    },
                    handle,
                    ensure_ascii=False,
                )
            os.replace(tmp_path, self._path(install_id))
        except OSError:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def can_process(self, install_id: str, video_id: str) -> tuple[bool, int]:
        """Return (allowed, remaining_free). Already-seen videos never count twice."""
        if not self.enabled or not self.valid_install_id(install_id):
            return True, self.limit
        record = self.get(install_id)
        if record.paid:
            return True, 0
        if video_id in record.videos:
            return True, max(0, self.limit - len(record.videos))
        remaining = max(0, self.limit - len(record.videos))
        return (remaining > 0), remaining

    def record_video(self, install_id: str, video_id: str) -> UsageRecord:
        record = self.get(install_id)
        if video_id not in record.videos:
            record.videos.append(video_id)
        self._write(install_id, record)
        return record

    def set_paid(self, install_id: str, paid: bool, email: str | None = None) -> UsageRecord:
        record = self.get(install_id)
        record.paid = paid
        if email:
            record.email = email[:200]
        self._write(install_id, record)
        return record

    def status(self, install_id: str | None) -> dict:
        if not self.valid_install_id(install_id):
            return {"used": 0, "limit": self.limit, "paid": False, "remaining": self.limit}
        record = self.get(install_id or "")
        return {
            "used": len(record.videos),
            "limit": self.limit,
            "paid": record.paid,
            "remaining": 0 if record.paid else max(0, self.limit - len(record.videos)),
        }
