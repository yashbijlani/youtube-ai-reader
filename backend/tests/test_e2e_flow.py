"""End-to-end product flow against a production-like app (fakes for external I/O).

Covers: sign-in -> process (chat-ready -> guide-ready) -> chat -> free quota ->
billing webhook activation -> paid access -> failure path. Uses MemoryStore,
an HS256 JWT and scripted providers, so no network is required.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time

import jwt
from fastapi.testclient import TestClient

from app.config import Settings
from app.errors import TranscriptUnavailable
from app.main import create_app
from tests.conftest import FakeTranscriptProvider, ScriptedAIProvider

JWT_SECRET = "e2e-jwt-secret"
PAY_SECRET = "e2e-pay-secret"
WEBHOOK_SECRET = "e2e-webhook-secret"
USER_ID = "44444444-4444-4444-4444-444444444444"
VIDEOS = ["dQw4w9WgXcQ", "9bZkp7q19f0", "kJQP7kiw5Fk", "JGwWNGJdvx8"]


def _token() -> str:
    return jwt.encode(
        {"sub": USER_ID, "aud": "authenticated", "role": "authenticated", "exp": int(time.time()) + 3600, "email": "e2e@test.com"},
        JWT_SECRET,
        algorithm="HS256",
    )


def _webhook_sig(body: bytes) -> str:
    return hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()


def _settings(tmp_path) -> Settings:
    settings = Settings(_env_file=None)
    settings.gemini_api_key = "test-key"
    settings.data_dir = tmp_path
    settings.auth_required = True
    settings.supabase_jwt_secret = JWT_SECRET
    settings.free_video_limit = 2
    settings.free_monthly_video_limit = 2
    settings.free_monthly_chat_limit = 5
    settings.razorpay_key_id = "rzp_test"
    settings.razorpay_key_secret = PAY_SECRET
    settings.razorpay_webhook_secret = WEBHOOK_SECRET
    settings.rate_limit_general_per_minute = 0
    settings.rate_limit_process_per_hour = 0
    settings.rate_limit_chat_per_hour = 0
    return settings


def _wait_for_guide(client: TestClient, video_id: str, headers: dict) -> dict:
    deadline = time.time() + 10
    state: dict = {}
    while time.time() < deadline:
        state = client.get(f"/api/videos/{video_id}", headers=headers).json()
        if state.get("analysis_status") in ("ready", "error"):
            return state
        time.sleep(0.05)
    return state


def test_full_product_flow(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    headers = {"Authorization": f"Bearer {_token()}", "X-Install-Id": "install-e2e"}

    with TestClient(app) as client:
        service = app.state.video_service
        fake_ai = ScriptedAIProvider()
        service.transcript_provider = FakeTranscriptProvider()
        service.ai_provider = fake_ai
        service.reader.provider = fake_ai

        # ---- account starts free
        me = client.get("/api/me", headers=headers).json()
        assert me["authenticated"] is True
        assert me["subscription"]["active"] is False
        assert me["usage"]["lifetime_videos"] == 0

        # ---- phase 1 + phase 2: process one video
        response = client.post("/api/videos/process", json={"youtube_url": VIDEOS[0]}, headers=headers)
        assert response.status_code == 200
        state = _wait_for_guide(client, VIDEOS[0], headers)
        assert state["status"] == "ready"
        assert state["analysis"]["overview"]
        assert state["analysis"]["chapters"]
        assert state["analysis"]["detailed_reading"]

        # ---- grounded chat (BM25 retrieval + citations)
        answer = client.post(
            f"/api/videos/{VIDEOS[0]}/chat",
            json={"message": "What does the speaker argue?", "stream": False},
            headers=headers,
        )
        assert answer.status_code == 200
        body = answer.json()
        assert body["answer"]
        assert body["citations"]

        # ---- usage reflected
        me = client.get("/api/me", headers=headers).json()
        assert me["usage"]["lifetime_videos"] == 1
        assert me["usage"]["videos_used"] == 1

        # ---- free quota: second video allowed, third blocked
        assert client.post("/api/videos/process", json={"youtube_url": VIDEOS[1]}, headers=headers).status_code == 200
        blocked = client.post("/api/videos/process", json={"youtube_url": VIDEOS[2]}, headers=headers)
        assert blocked.status_code == 402
        assert blocked.json()["error"]["code"] == "quota_exceeded"

        # ---- billing webhook activates Pro
        event = {
            "id": "evt_e2e",
            "event": "payment.captured",
            "payload": {"payment": {"entity": {"id": "pay_e2e", "notes": {"user_id": USER_ID}}}},
        }
        body = json.dumps(event).encode()
        webhook = client.post(
            "/api/billing/webhook",
            content=body,
            headers={"x-razorpay-signature": _webhook_sig(body), "Content-Type": "application/json"},
        )
        assert webhook.status_code == 200
        me = client.get("/api/me", headers=headers).json()
        assert me["subscription"]["active"] is True

        # ---- paid user is no longer limited
        assert client.post("/api/videos/process", json={"youtube_url": VIDEOS[2]}, headers=headers).status_code == 200
        me = client.get("/api/me", headers=headers).json()
        assert me["usage"]["lifetime_videos"] == 2  # pro does not consume free slots

        # ---- canonical cache: reprocessing is instant and does not re-hit the provider
        calls_before = fake_ai.models.copy()
        cached = client.post("/api/videos/process", json={"youtube_url": VIDEOS[0]}, headers=headers)
        assert cached.status_code == 200
        assert cached.json()["cached"] is True
        assert fake_ai.models == calls_before

        # ---- failure path: no transcript
        service.transcript_provider = FakeTranscriptProvider(error=TranscriptUnavailable())
        failed = client.post("/api/videos/process", json={"youtube_url": VIDEOS[3]}, headers=headers)
        assert failed.status_code == 200
        state = _wait_for_guide(client, VIDEOS[3], headers)
        assert state["status"] == "error"
        assert state["error"]["code"] == "transcript_unavailable"


def test_unauthenticated_flow_is_rejected(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    with TestClient(app) as client:
        assert client.post("/api/videos/process", json={"youtube_url": VIDEOS[0]}).status_code == 401
        assert client.post(f"/api/videos/{VIDEOS[0]}/chat", json={"message": "hi"}).status_code == 401
        assert client.get("/api/me").status_code == 401
