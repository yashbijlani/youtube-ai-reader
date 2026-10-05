"""Filesystem-backed cache for processed videos.

One canonical processed representation per video id, on disk. Swapping this for
Redis/Postgres later means reimplementing this small interface.
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from pathlib import Path
from typing import Any

from app.config import Settings

logger = logging.getLogger("youtube_ai_reader.cache")

_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


class FileCache:
    def __init__(self, settings: Settings) -> None:
        self.enabled = settings.cache_enabled
        self.root = settings.cache_dir
        if self.enabled:
            self.root.mkdir(parents=True, exist_ok=True)

    def _video_dir(self, video_id: str) -> Path:
        if not _SAFE_ID_RE.match(video_id or ""):
            raise ValueError("unsafe video id")
        return self.root / video_id

    def read_json(self, video_id: str, name: str) -> Any | None:
        if not self.enabled:
            return None
        path = self._video_dir(video_id) / f"{name}.json"
        if not path.exists():
            return None
        try:
            with path.open("r", encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, json.JSONDecodeError):
            logger.warning("[cache] corrupt entry video=%s name=%s", video_id, name)
            return None

    def write_json(self, video_id: str, name: str, data: Any) -> None:
        if not self.enabled:
            return
        directory = self._video_dir(video_id)
        directory.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=directory, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False)
            os.replace(tmp_path, directory / f"{name}.json")
        except OSError:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def delete(self, video_id: str, name: str) -> None:
        if not self.enabled:
            return
        path = self._video_dir(video_id) / f"{name}.json"
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
