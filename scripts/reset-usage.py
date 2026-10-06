#!/usr/bin/env python3
"""Reset testing accounts: usage counters and (optionally) users.

Usage (from the repo root):
    # clear free-usage counters for everyone (keeps users)
    backend/.venv/bin/python scripts/reset-usage.py --all

    # clear usage + delete all users (Supabase profiles and auth users)
    backend/.venv/bin/python scripts/reset-usage.py --all --delete-users

    # scope to specific accounts
    backend/.venv/bin/python scripts/reset-usage.py --email me@example.com --delete-users

This only touches account/usage state. It does not touch the canonical video
cache (use scripts/clear-video-cache.py for that).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import httpx  # noqa: E402

from app.config import Settings  # noqa: E402


def _rest(settings: Settings) -> tuple[str, dict[str, str]]:
    base = settings.supabase_url.rstrip("/") + "/rest/v1"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    return base, headers


def _auth(settings: Settings) -> tuple[str, dict[str, str]]:
    base = settings.supabase_url.rstrip("/") + "/auth/v1"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    return base, headers


def _select(client: httpx.Client, base: str, headers: dict, table: str, filters: dict) -> list[dict]:
    params = {"select": "*", "limit": "10000", **filters}
    r = client.get(f"{base}/{table}", headers=headers, params=params)
    return r.json() if r.status_code == 200 else []


def _delete(client: httpx.Client, base: str, headers: dict, table: str, filters: dict) -> int:
    r = client.delete(f"{base}/{table}", headers=headers, params=filters)
    if r.status_code >= 400:
        print(f"  {table}: HTTP {r.status_code} {r.text[:120]}")
        return 0
    return 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", action="append", default=[])
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--delete-users", action="store_true")
    args = parser.parse_args()
    if not args.all and not args.email:
        parser.error("pass --email <addr> (repeatable) or --all")

    settings = Settings(_env_file=str(ROOT / "backend" / ".env"), _env_file_encoding="utf-8")
    if not settings.supabase_configured:
        parser.error("Supabase is not configured in backend/.env")

    base, headers = _rest(settings)
    auth_base, auth_headers = _auth(settings)

    with httpx.Client(timeout=30) as client:
        # Resolve target user ids.
        if args.all:
            users = _select(client, base, headers, "users", {})
            ids = [u["id"] for u in users]
        else:
            ids = []
            for email in args.email:
                rows = _select(client, base, headers, "users", {"email": f"eq.{email}"})
                ids.extend(u["id"] for u in rows)
            if not ids:
                print("No matching users found.")
                return

        print(f"target users: {len(ids)}")

        # ---- usage counters (either per-user or all)
        usage_filter = {"user_id": "not.is.null"} if args.all else {"user_id": f"in.({','.join(ids)})"}
        for table in ("used_videos", "usage_periods"):
            _delete(client, base, headers, table, usage_filter)
            print(f"  cleared {table}")

        if args.delete_users:
            if args.all:
                user_filter = {"id": "not.is.null"}
            else:
                user_filter = {"id": f"in.({','.join(ids)})"}
            _delete(client, base, headers, "subscriptions", usage_filter)
            _delete(client, base, headers, "users", user_filter)
            print("  deleted subscriptions + profiles")

            # Delete Supabase auth users (recreated on next sign-in).
            listed = client.get(f"{auth_base}/admin/users", headers=auth_headers, params={"per_page": "1000"})
            auth_users = listed.json().get("users", []) if listed.status_code == 200 else []
            target_emails = None if args.all else {e.lower() for e in args.email}
            deleted = 0
            for au in auth_users:
                if target_emails is not None and (au.get("email") or "").lower() not in target_emails:
                    continue
                d = client.delete(f"{auth_base}/admin/users/{au['id']}", headers=auth_headers)
                if d.status_code < 400:
                    deleted += 1
            print(f"  deleted {deleted} auth users")
        else:
            print("  (users kept; pass --delete-users to remove them)")


if __name__ == "__main__":
    main()
