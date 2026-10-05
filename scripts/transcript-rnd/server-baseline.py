#!/usr/bin/env python3
"""Method I baseline: measure the existing production server transcript path.

Reuses the real ``YtDlpTranscriptProvider`` (yt-dlp + youtube-transcript-api
fallback, with the production request pacing) so the numbers reflect what the
backend actually does. Writes ``results/server.json`` incrementally.

Usage (from the repo root):
    backend/.venv/bin/python scripts/transcript-rnd/server-baseline.py --limit 20
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.config import Settings  # noqa: E402
from app.errors import AppError  # noqa: E402
from app.services.transcript import YtDlpTranscriptProvider  # noqa: E402


def load_corpus(path: str, limit: int, start: int) -> list[dict]:
    data = json.loads((Path(__file__).parent / path).read_text())
    return data[start : start + limit]


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--out", default="results/server.json")
    parser.add_argument("--corpus", default="corpus.json")
    parser.add_argument("--save-transcripts", action="store_true")
    args = parser.parse_args()
    transcript_dir = Path(__file__).parent / "results" / "transcripts"
    if args.save_transcripts:
        transcript_dir.mkdir(parents=True, exist_ok=True)

    settings = Settings()
    provider = YtDlpTranscriptProvider(settings)
    corpus = load_corpus(args.corpus, args.limit or 10**9, args.start)
    out_path = Path(__file__).parent / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    results: list[dict] = json.loads(out_path.read_text()) if out_path.exists() else []
    done = {r["video_id"] for r in results}

    for i, item in enumerate(corpus, 1):
        vid = item["id"]
        if vid in done:
            print(f"[server] {i}/{len(corpus)} {vid} (cached)")
            continue
        started = time.monotonic()
        record: dict = {
            "video_id": vid,
            "category": item["category"],
            "method": "server_ytdlp",
            "success": False,
            "latency_ms": None,
            "segment_count": 0,
            "character_count": 0,
            "language": None,
            "kind": None,
            "source": None,
            "error": None,
        }
        try:
            result = await provider.fetch(vid)
            record.update(
                success=True,
                segment_count=len(result.transcript.segments),
                character_count=result.transcript.char_count,
                language=result.transcript.language,
                kind=result.transcript.kind,
                title=result.meta.title,
                duration=result.meta.duration,
                source="ytdlp",
            )
        except AppError as exc:
            record["error"] = f"{exc.code}: {exc.message[:160]}"
        except Exception as exc:  # noqa: BLE001
            record["error"] = f"{type(exc).__name__}: {str(exc)[:160]}"
        record["latency_ms"] = int((time.monotonic() - started) * 1000)
        if args.save_transcripts and record["success"]:
            try:
                result  # type: ignore[possibly-undefined]
                (transcript_dir / f"{vid}.server.json").write_text(
                    json.dumps(
                        {
                            "video_id": vid,
                            "source": "server_ytdlp",
                            "title": result.meta.title,
                            "duration": result.meta.duration,
                            "language": result.transcript.language,
                            "kind": result.transcript.kind,
                            "segments": [
                                {"start": s.start, "end": s.end, "text": s.text}
                                for s in result.transcript.segments
                            ],
                        }
                    )
                )
            except Exception as exc:  # noqa: BLE001
                print(f"[server] transcript save failed {vid}: {exc}", flush=True)
        results.append(record)
        out_path.write_text(json.dumps(results, indent=2))
        ok = "ok" if record["success"] else f"FAIL {record['error']}"
        print(
            f"[server] {i}/{len(corpus)} {vid} cat={item['category']} "
            f"segs={record['segment_count']} {record['latency_ms']}ms {ok}",
            flush=True,
        )


if __name__ == "__main__":
    asyncio.run(main())
