#!/usr/bin/env python3
"""Real end-to-end verification against a running backend.

Usage:
    OPENCODE_API_KEY=... uvicorn app.main:app --port 8000   # terminal 1
    python scripts/e2e-backend.py [youtube_url]             # terminal 2

Exercises the real pipeline: yt-dlp metadata + captions, AI analysis, cached
reprocessing, non-streaming chat with citations, and SSE streaming.
"""

from __future__ import annotations

import json
import os
import sys
import time

import httpx

BASE = os.environ.get("BACKEND_URL", "http://127.0.0.1:8000").rstrip("/")
VIDEO_URL = sys.argv[1] if len(sys.argv) > 1 else "https://www.youtube.com/watch?v=aircAruvnKk"


def main() -> int:
    with httpx.Client(timeout=30) as client:
        health = client.get(f"{BASE}/api/health").json()
        if "ai_configured" not in health:
            print(f"{BASE} does not look like a YouTube AI Reader backend: {health}")
            return 1
        print("health:", health)
        assert health["ai_configured"], "Set OPENCODE_API_KEY on the backend first"

        print(f"\nprocessing {VIDEO_URL}")
        started = time.time()
        response = client.post(
            f"{BASE}/api/videos/process", json={"youtube_url": VIDEO_URL}, timeout=60
        )
        response.raise_for_status()
        state = response.json()
        video_id = state["video_id"]
        last_stage = None
        while state["status"] not in ("ready", "error") and time.time() - started < 600:
            state = client.get(f"{BASE}/api/videos/{video_id}").json()
            stage = f"{state.get('stage')} | {state.get('stage_message')}"
            if stage != last_stage:
                print(f"  [{time.time() - started:6.1f}s] {stage}")
                last_stage = stage
            time.sleep(1.5)

        assert state["status"] == "ready", json.dumps(state)[:2000]
        analysis = state["analysis"]
        print(f"\nready in {time.time() - started:.1f}s")
        print("title:", state["metadata"]["title"])
        print("key points:", len(analysis["key_points"]), "chapters:", len(analysis["chapters"]))
        assert analysis["overview"]
        assert analysis["detailed_reading"]

        transcript = client.get(f"{BASE}/api/videos/{video_id}/transcript").json()
        print("transcript segments:", len(transcript["segments"]))
        assert transcript["segments"]

        chat = client.post(
            f"{BASE}/api/videos/{video_id}/chat",
            json={"message": "What is the main argument? Cite moments.", "history": []},
            timeout=300,
        ).json()
        print("\nanswer:", chat["answer"][:400])
        print("citations:", chat["citations"])
        assert chat["answer"] and chat["citations"]

        with client.stream(
            "POST",
            f"{BASE}/api/videos/{video_id}/chat",
            json={"message": "Summarize this simply.", "stream": True},
            timeout=300,
        ) as stream:
            chars = 0
            done = False
            for line in stream.iter_lines():
                if not line.startswith("data:"):
                    continue
                event = json.loads(line[5:].strip())
                if event["type"] == "delta":
                    chars += len(event["text"])
                elif event["type"] == "done":
                    done = True
        print("streamed chars:", chars)
        assert chars > 50 and done

        again = client.post(
            f"{BASE}/api/videos/process", json={"youtube_url": VIDEO_URL}, timeout=60
        ).json()
        print("cached reprocess:", again["cached"])
        assert again["cached"] is True

    print("\nE2E PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
