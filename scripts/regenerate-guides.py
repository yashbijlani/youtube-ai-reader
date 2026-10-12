#!/usr/bin/env python3
"""Regenerate the reading guide for already-transcribed videos.

Calls the authenticated ``/api/videos/{id}/repair`` endpoint, which rebuilds the
analysis from the *cached transcript* (no yt-dlp, no re-capture). Use this to fix
videos whose guide previously failed because the client transcript was discarded.

Usage:
    YAIR_API=https://youtube-ai-reader.onrender.com \
    YAIR_TOKEN=<supabase-access-token> \
        backend/.venv/bin/python scripts/regenerate-guides.py VIDEO_ID [VIDEO_ID ...]
"""

from __future__ import annotations

import os
import sys

import httpx


def main() -> int:
    api = os.environ.get("YAIR_API", "https://youtube-ai-reader.onrender.com").rstrip("/")
    token = os.environ.get("YAIR_TOKEN", "").strip()
    video_ids = sys.argv[1:]
    if not video_ids:
        print(__doc__)
        return 1
    if not token:
        print("Set YAIR_TOKEN to a signed-in user's Supabase access token.")
        return 1

    headers = {"Authorization": f"Bearer {token}"}
    with httpx.Client(timeout=60.0) as client:
        for video_id in video_ids:
            response = client.post(f"{api}/api/videos/{video_id}/repair", headers=headers)
            print(f"{video_id} -> {response.status_code} {response.text[:160]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
