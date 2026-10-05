"""Security hardening tests: legacy routes removed, headers, ingest gating."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.youtube import extract_video_id
from app.errors import InvalidYouTubeUrl


def _settings(tmp_path) -> Settings:
    settings = Settings(_env_file=None)
    settings.gemini_api_key = "test-key"
    settings.data_dir = tmp_path
    settings.rate_limit_general_per_minute = 0
    settings.rate_limit_process_per_hour = 0
    return settings


def test_legacy_client_entitlement_route_is_gone(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    with TestClient(app) as client:
        response = client.post("/api/entitlement", json={"paid": True})
        assert response.status_code in (404, 405)


def test_security_headers_are_set(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.headers.get("x-content-type-options") == "nosniff"
        assert response.headers.get("x-frame-options") == "DENY"


def test_client_transcripts_can_be_disabled(tmp_path) -> None:
    settings = _settings(tmp_path)
    settings.trust_client_transcripts = False
    settings.auth_required = False
    app = create_app(settings)
    with TestClient(app) as client:
        response = client.post(
            "/api/videos/dQw4w9WgXcQ/ingest",
            json={
                "title": "T",
                "language": "en",
                "kind": "manual",
                "format": "json3",
                "content": '{"events":[]}',
            },
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "forbidden"


def test_video_id_validation_rejects_injection_attempts() -> None:
    bad_inputs = [
        "--exec=touch /tmp/pwned",
        "dQw4w9WgXcQ; rm -rf /",
        "https://evil.example.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/watch?v=../../etc/passwd",
        "not-a-video-id",
        "",
    ]
    for value in bad_inputs:
        try:
            extract_video_id(value)
        except InvalidYouTubeUrl:
            continue
        raise AssertionError(f"expected rejection for {value!r}")


def test_valid_video_id_shapes_are_accepted() -> None:
    assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"
