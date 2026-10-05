#!/usr/bin/env python3
"""Purge canonical video cache entries (filesystem + Supabase).

Usage (from the repo root):
    backend/.venv/bin/python scripts/clear-video-cache.py --video-id G47JucpO8Sk
    backend/.venv/bin/python scripts/clear-video-cache.py --all
    backend/.venv/bin/python scripts/clear-video-cache.py --all --fs-only
    backend/.venv/bin/python scripts/clear-video-cache.py --all --supabase-only

This only removes regenerable cache/analysis data; user/billing rows are
untouched.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import httpx  # noqa: E402

from app.config import Settings  # noqa: E402


def purge_filesystem(settings: Settings, video_ids: list[str] | None) -> int:
    root = settings.cache_dir
    if not root.is_absolute():
        root = (ROOT / "backend" / root).resolve()
    if not root.exists():
        return 0
    count = 0
    targets = [root / vid for vid in video_ids] if video_ids else list(root.iterdir())
    for path in targets:
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
            count += 1
    return count


def purge_supabase(settings: Settings, video_ids: list[str] | None) -> int:
    if not settings.supabase_configured:
        print("Supabase not configured; skipping.")
        return 0
    base = settings.supabase_url.rstrip("/") + "/rest/v1"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    tables = ["video_analysis", "transcripts", "videos"]
    removed = 0
    with httpx.Client(timeout=20) as client:
        for table in tables:
            key = "id" if table == "videos" else "video_id"
            if video_ids:
                params = {key: f"in.({','.join(video_ids)})"}
            else:
                params = {key: "not.is.null"}  # match all real rows
            response = client.request("DELETE", f"{base}/{table}", headers=headers, params=params)
            if response.status_code >= 400:
                print(f"  {table}: HTTP {response.status_code} {response.text[:120]}")
            else:
                print(f"  {table}: purged")
                removed += 1
    return removed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", action="append", default=[])
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--fs-only", action="store_true")
    parser.add_argument("--supabase-only", action="store_true")
    args = parser.parse_args()

    if not args.all and not args.video_id:
        parser.error("pass --video-id <id> (repeatable) or --all")

    settings = Settings(_env_file=str(ROOT / "backend" / ".env"), _env_file_encoding="utf-8")
    video_ids = None if args.all else args.video_id

    if not args.supabase_only:
        n = purge_filesystem(settings, video_ids)
        print(f"filesystem entries removed: {n}")
    if not args.fs_only:
        print("supabase:")
        purge_supabase(settings, video_ids)
    print(json.dumps({"video_ids": video_ids or "ALL"}))


if __name__ == "__main__":
    main()
