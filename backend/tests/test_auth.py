"""Supabase JWT auth tests (HS256 path, no network)."""

from __future__ import annotations

import time

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.errors import Unauthorized
from app.main import create_app
from app.services.auth import SupabaseAuth

SECRET = "test-jwt-secret"


def _token(sub: str = "11111111-1111-1111-1111-111111111111", *, exp_offset: int = 3600, email: str | None = "a@b.com") -> str:
    payload = {
        "sub": sub,
        "aud": "authenticated",
        "role": "authenticated",
        "exp": int(time.time()) + exp_offset,
    }
    if email:
        payload["email"] = email
    return jwt.encode(payload, SECRET, algorithm="HS256")


def _settings(tmp_path) -> Settings:
    settings = Settings(_env_file=None)
    settings.gemini_api_key = "test-key"
    settings.data_dir = tmp_path
    settings.auth_required = True
    settings.supabase_jwt_secret = SECRET
    settings.rate_limit_general_per_minute = 0
    settings.rate_limit_process_per_hour = 0
    settings.rate_limit_chat_per_hour = 0
    return settings


async def test_verify_valid_token() -> None:
    auth = SupabaseAuth(Settings(_env_file=None, SUPABASE_JWT_SECRET=SECRET))
    user = await auth.verify(_token())
    assert user.id == "11111111-1111-1111-1111-111111111111"
    assert user.email == "a@b.com"


async def test_verify_expired_token_rejected() -> None:
    auth = SupabaseAuth(Settings(_env_file=None, SUPABASE_JWT_SECRET=SECRET))
    with pytest.raises(Unauthorized):
        await auth.verify(_token(exp_offset=-10))


async def test_verify_wrong_signature_rejected() -> None:
    auth = SupabaseAuth(Settings(_env_file=None, SUPABASE_JWT_SECRET=SECRET))
    forged = jwt.encode({"sub": "x", "aud": "authenticated", "exp": int(time.time()) + 60}, "other-secret", algorithm="HS256")
    with pytest.raises(Unauthorized):
        await auth.verify(forged)


async def test_verify_missing_subject_rejected() -> None:
    auth = SupabaseAuth(Settings(_env_file=None, SUPABASE_JWT_SECRET=SECRET))
    token = jwt.encode({"aud": "authenticated", "exp": int(time.time()) + 60}, SECRET, algorithm="HS256")
    with pytest.raises(Unauthorized):
        await auth.verify(token)


def test_me_requires_auth_when_enforced(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    with TestClient(app) as client:
        assert client.get("/api/me").status_code == 401
        assert client.get("/api/videos/dQw4w9WgXcQ").status_code == 401
        assert client.post("/api/videos/process", json={"youtube_url": "dQw4w9WgXcQ"}).status_code == 401


def test_me_returns_account_with_valid_token(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    headers = {"Authorization": f"Bearer {_token()}"}
    with TestClient(app) as client:
        response = client.get("/api/me", headers=headers)
        assert response.status_code == 200
        body = response.json()
        assert body["authenticated"] is True
        assert body["user"]["id"] == "11111111-1111-1111-1111-111111111111"
        assert body["subscription"]["active"] is False
        assert body["usage"]["free_limit"] == 3


def test_client_cannot_impersonate_another_user(tmp_path) -> None:
    """A token for user A must never be able to act as user B."""
    app = create_app(_settings(tmp_path))
    token_b = _token(sub="22222222-2222-2222-2222-222222222222", email="b@b.com")
    with TestClient(app) as client:
        body = client.get("/api/me", headers={"Authorization": f"Bearer {token_b}"}).json()
        assert body["user"]["id"] == "22222222-2222-2222-2222-222222222222"
        assert body["user"]["id"] != "11111111-1111-1111-1111-111111111111"


def test_health_is_public(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
