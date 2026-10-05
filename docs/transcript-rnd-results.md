# Browser-side transcript extraction — engineering results

R&D spike: can our Chrome MV3 extension obtain accurate, timestamped YouTube
transcripts from the user's own browser/session, replacing server-side `yt-dlp`
as the primary path?

**All numbers below are measured.** Raw data:
`scripts/transcript-rnd/results/{raw.json,raw2.json,server.json,summary.json,comparison.json}`.
Re-run with the commands in [Reproduction](#reproduction). Nothing in this report
is estimated unless explicitly labelled "not benchmarked".

Environment: Chromium **152.0.7977.82** (Arch), Python 3.12.14, yt-dlp
2026.08.19, ffmpeg n9.0.1, 16 logical CPUs / 16 GB RAM, headed browser on a real
display with a persistent profile. Extension harness code:
`extension/src/transcript-rnd/`.

---

## Executive conclusion

YouTube now mints a proof-of-origin (`pot`) token inside the page and refuses
caption downloads without it, so **we cannot fetch captions ourselves**, and
`get_transcript` returns `400 failedPrecondition`. However, YouTube's own player
still fetches the captions successfully. **Intercepting that request's response
by patching `XMLHttpRequest`/`fetch` in the page's MAIN world is reliable: 41 of
42 captioned videos (97.6%), 100% timestamped, median 5.5 s, and 36/41 with full
duration coverage.** Output is essentially identical to server yt-dlp (9 of 12
compared pairs ≥95% vocabulary overlap; 7 byte-identical). Server yt-dlp remains
necessary but only as a fallback: it succeeded on 39/60 videos (65%), was 3.4×
slower (median 18.6 s), and lost 6 videos to HTTP 429. The production chain
should be **MAIN-world interception → rendered-caption DOM → server yt-dlp →
unsupported**, with local ASR deferred (no viable on-device ASR; WASM ASR is a
~41 MB per-client download for the minority of videos with no captions).

---

## Results table

Corpus: 60 videos discovered from YouTube search across 10 categories.
Of these, **42 had captions**, **13 had none**, **5 could not be inspected**
(Chromium connection closed on very large ambient videos, one 8 h long).

| Method | Success (captioned) | Timestamped | Median latency | P95 latency | Avg segments | Cost | Recommendation |
|---|---:|---:|---:|---:|---:|---|---|
| A — player-response direct fetch | 0/42 (0%) | — | — | — | — | ₹0 | **Reject** (empty body, `pot`) |
| **C — MAIN-world intercept** | **41/42 (97.6%)** | **100%** | **5,546 ms** | 6,790 ms | 924 | ₹0 | **Primary** |
| D — rendered caption DOM | 35/42 (83.3%) | 100% | 6,092 ms | 6,414 ms | **7** | ₹0 | Fallback (lossy) |
| F — native transcript panel | 0/42 (0%) | — | — | — | — | ₹0 | **Reject** (`400 failedPrecondition`) |
| G — Chrome on-device/Web Speech | not viable | — | — | — | — | ₹0 | **Reject** (no ASR API) |
| H — browser WASM ASR | feasible, not benchmarked | expected yes | not benchmarked | — | — | ~41 MB/client | Deferred |
| I — server yt-dlp (+fallback) | 39/60 (65%) | 100% | 18,612 ms | 68,528 ms | 1,189 | server | **Last-resort fallback** |

Method C quality: **36/41 successes had ≥90% duration coverage**; 5 were partial
(<90%), and 6 of the 42 captioned videos were Shorts where coverage is inherently
noisy. Method A always returned `HTTP 200`, `Content-Type: text/html`, **0 bytes**.

### Per-category (browser Method C)

| Category | n | has captions | no captions | C success |
|---|---:|---:|---:|---:|
| A normal podcast | 6 | 6 | 0 | 6 |
| B long podcast | 6 | 6 | 0 | 6 |
| C auto captions | 6 | 6 | 0 | 6 |
| D manual captions | 6 | 5 | 1 | 4 |
| F multilanguage | 6 | 6 | 0 | 6 |
| G popular | 6 | 5 | 1 | 5 |
| H recent | 6 | 3 | 3 | 4 |
| I Shorts | 6 | 5 | 1 | 5 |
| J live/recently streamed | 6 | 0 | 6 | 1 |
| E no captions | 6 | 0 | 1 | 0 |

---

## Method-by-method findings

### Method A — player-response / page-state fetch — **REJECT**

- **Worked:** caption *metadata* is fully available to the page:
  `#movie_player.getPlayerResponse().captions.playerCaptionsTracklistRenderer.captionTracks`
  exposes language, `kind` (manual/`asr`), and a signed `baseUrl`. One video
  exposed 31 tracks (30 manual + 1 ASR).
- **Failed:** fetching that `baseUrl` (with `&fmt=json3`, `credentials: "include"`,
  in page context) returns **HTTP 200 with a 0-byte `text/html` body** on every
  video. The URL is missing the `pot` proof-of-origin token the player adds later.
- **Why:** YouTube's 2026 anti-bot change; identical result in headless and headed
  browsers. Confirms the README's original hypothesis as fact.
- Maintenance risk: low (we no longer depend on this path).

### Method B — MAIN-world / isolated world — **NECESSARY ENABLER**

- Page state and the signed caption request are only reachable from the **MAIN
  world** (`chrome.scripting.executeScript({ world: "MAIN" })` or a
  `document_start` MAIN-world content script). The isolated content-script world
  cannot see `#movie_player.getPlayerResponse()`. A validated `postMessage`
  bridge (`bridge.ts`) or `executeScript` read-back is required.
- Security: messages are accepted only when `event.source === window`, with the
  matching `source`/`token`/`type` shape; content is never executed.

### Method C — observe YouTube's own caption request — **PRIMARY**

- **Worked (97.6%):** YouTube's player issues `/api/timedtext` **twice**: first
  unsigned (empty), then **with `pot`+`potc`** whose body is full json3
  (`wireMagic: pb3`, `tStartMs`/`dDurationMs` per event). Patching `XMLHttpRequest`
  (the transport YouTube uses today) and `fetch` in the MAIN world captures that
  body. Example: a 63-min talk → 46 KB json3 / 286 events; another → 112 KB.
- **Trigger is load-bearing:** set the track via `player.setOption("captions",
  "track", …)`, **toggle `.ytp-subtitles-button`**, then `playVideo()`. This forces
  a fresh signed request *after* the interceptor is installed. A seek-based
  trigger performed worse; a strict conditional click failed.
- **Failure modes:** 1/42 captioned video produced no response; for a handful of
  long/ASR-only videos a first partial response won (mitigated by collecting all
  responses and keeping the largest, plus a fresh-page retry).
- **Timestamps:** 100% of captured transcripts were timestamped; first/last
  timestamps matched server yt-dlp within ~0.5 s on aligned tracks.

### Method D — rendered caption DOM — **FALLBACK (lossy)**

- `.ytp-caption-segment` text renders once a trusted session is used; success
  83.3% but only **~7 segments** captured in a 6 s window, with duplicate lines,
  and stamps taken from `video.currentTime` sampling. Real-time only: no
  fast-forward, seeking loses lines. Keep only as a last-ditch fallback.

### Method F — native transcript panel — **REJECT**

- `POST /youtubei/v1/get_transcript` with the page's own `context` + params
  returns **`400 Precondition check failed` (`failedPrecondition`)** on every
  video, matching the README note. The panel never populated in automation.

### Method G — Chrome on-device / Web Speech — **NOT VIABLE**

Measured in Chromium 152:
- `LanguageModel`, `Translator`, `Summarizer` exist (Gemini-Nano text models) —
  **there is no on-device speech-recognition API.**
- `SpeechRecognition`/`webkitSpeechRecognition` exist but are **microphone +
  Google-cloud**, do **not** accept an audio stream, and cannot transcribe tab
  audio. A user would have to play audio aloud into the mic.
- `MediaRecorder` exists, so tab audio *can* be captured (`chrome.tabCapture`),
  but there is no engine to feed it to natively.

### Method H — browser WASM ASR — **FEASIBLE, DEFERRED (not benchmarked)**

Measured facts:
- WASM **SIMD: yes**; **WebGPU: available**; **`SharedArrayBuffer`/threads: no**
  (page not cross-origin isolated) → single-threaded WASM.
- `@huggingface/transformers` v4.3.0 unpacked ≈ **9.9 MB**.
- `onnx-community/whisper-tiny` quantized ONNX: encoder **10.1 MB** + decoder
  **30.7 MB** ≈ **41 MB** download (+ tokenizer/config). `base` is ~2–3×.
- Real-time factor / RAM / accuracy were **not benchmarked** (out of scope for
  this spike; would require a tab-audio capture harness). Not recommended to ship
  to every client for the minority of videos with no captions.

### Method I — server yt-dlp (+ `youtube-transcript-api`) — **FALLBACK**

Reused the production `YtDlpTranscriptProvider` unchanged.

- 60 videos: **39 success (65%)**; median **18.6 s**, p95 **68.5 s**, avg 29.4 s.
- Failures: **10 `transcript_unavailable`** (no captions at all), **6
  `youtube_rate_limited` (HTTP 429)**, **4 `video_unavailable`**, **1 parsing**.
- The 429s and 60–70 s latencies appeared under serialised pacing
  (`YTDLP_CONCURRENCY=1`, 4 s spacing, one fallback). It is strictly a fallback.

---

## Transcript correctness (browser C vs server yt-dlp)

12 shared videos, normalised (lowercase, punctuation/whitespace stripped,
stop-words removed); "vocab containment" = fraction of browser vocabulary
present in the server transcript.

| Video | Browser segs | Server segs | Browser words | Server words | Last ts b/s | Vocab |
|---|---:|---:|---:|---:|---|---:|
| 7ARBJQn6QkM | 581 | 1500 | 9735 | 10277 | 3770.9/3774.5 | 98% |
| DrM1rex7ooc | 4493 | 4491 | 28345 | 28345 | 10759.0/10759.0 | **100%** |
| GOqEl4ADyVk | 3265 | 3265 | 23522 | 23522 | 6650.1/6650.1 | **100%** |
| P26AE7NLx4Q | 2 | 400 | 8 | 2673 | 19.1/962.1 | 29% |
| T9Bmk8NxGzo | 93 | 93 | 868 | 868 | 626.6/626.6 | **100%** |
| ZigBoJEH0og | 38 | 38 | 262 | 262 | 70.3/70.3 | **100%** |
| jx-w8M-hW20 | 19 | 19 | 38 | 38 | 56.3/56.3 | **100%** |
| kJQP7kiw5Fk | 90 | 79 | 447 | 547 | 268.3/247.5 | 8% |
| oX7OduG1YmI | 477 | 1227 | 8201 | 8343 | 2812.5/2816.7 | 99% |
| tB88DEBk5tw | 134 | 134 | 856 | 856 | 339.4/339.4 | **100%** |
| todTT866rx8 | 45 | 45 | 553 | 553 | 251.7/251.7 | **100%** |
| xAt1xcC6qfM | 988 | 938 | 5369 | 6331 | 2538.3/2600.0 | 95% |

- **9/12 pairs ≥95% overlap; 7/12 byte-identical** word-for-word — the browser is
  obtaining the *same caption data* as the server, without scraping.
- **Granularity differs, content does not:** manual tracks are phrase-level
  (fewer segments), server/ASR tracks are word-level (more segments) with the
  same words (98–99% for `7ARBJQn6QkM`, `oX7OduG1YmI`).
- **Two real caveats:** `P26AE7NLx4Q` captured only 2 segments (partial/flaky —
  mitigated in production by largest-response selection + fresh-page retry);
  `kJQP7kiw5Fk` (a music video) picked a different track (8% overlap) — track/
  language selection must prefer a manual track in the requested language and
  validate sanity (coverage vs duration).
- Manually inspected samples confirm readable, correctly-ordered prose with
  sensible `[mm:ss]` stamps; timestamps aligned with the server within ~0.5 s.

---

## Recommended production fallback chain

Chosen from the measurements (not from the illustrative example):

```
1. Browser MAIN-world caption interception   (97.6% of captioned videos, ~5s)   ← PRIMARY
2. Browser rendered-caption DOM              (lossy, real-time, last resort)
3. Server yt-dlp + youtube-transcript-api    (65% overall; 429-prone; ~19s)     ← server fallback
4. Unsupported                               ("Couldn't obtain a transcript")
```

Local ASR (WASR) is deliberately **not** in the chain. It only helps the ~22% of
videos with no captions (`13/60` here), at the cost of a ~41 MB+ per-client model
download and heavy CPU/GPU, with no threads. If no-caption coverage becomes a
priority, evaluate **server-side** ASR on the fallback host first.

Server-side YouTube traffic that remains: only the fallback (uncaptioned videos,
failed/partial browser captures). In this corpus Method C would have removed
~97.6% of the server transcript fetches for captioned videos.

---

## Compatibility matrix

| Dimension | Observed |
|---|---|
| Chrome | Chromium 152 (MV3); MAIN-world `chrome.scripting` required |
| Transport | `/api/timedtext` over `XMLHttpRequest` (+ `fetch` patched defensively) |
| Auth | none needed by us; we reuse the player's session + `pot` |
| Desktop OS | Linux (tested); mechanism is browser-level, OS-agnostic |
| Caption type | manual and auto/ASR both captured |
| Language | multi-track; selection by `languageCode` (defaults `en`) |
| Video type | normal, long (3 h), auto/manual, Shorts; live generally has no tracks |
| No captions | out of scope for C/D → server fallback or unsupported |
| Headless | detection can yield empty/partial captions; **real user sessions** are the target |

---

## Remaining risks

- **YouTube can change the transport/trigger** (XHR→fetch/stream, CC toggle,
  `setOption`, json3 shape). Parsers and the interceptor are isolated and tested.
- **Track selection**: content can match but the *track* can differ (music video
  case). Add coverage-sanity + explicit manual-track preference.
- **Partial first response** on long/ASR-only videos. Keep "largest response"
  selection and a fresh-page retry; consider a minimum-coverage gate.
- **Anti-automation**: strictly-automated sessions may be served empty captions.
  Real user browsers are unaffected; do not build evasion into the product.
- **Live streams**: often expose no caption tracks; keep server/“unsupported”.
- **MV3 review/scope**: requires `scripting` + host permission (already present);
  keep the interceptor narrowly scoped to `/api/timedtext`.
- **Privacy**: transcripts are user-session data; only `video_id` + transcript go
  to our backend. Never forward cookies/tokens.

---

## Reproduction

```bash
# 1. Build the debug UI (extension/dist/rnd/debug.html)
cd extension && npm run build:rnd

# 2. Harness deps (puppeteer-core only)
cd scripts/transcript-rnd && npm install

# 3. Corpus + experiments (headed Chromium with a persistent profile)
node discover-corpus.mjs
node run-experiments.mjs --methods=A,C,F --dom      # writes results/raw.json
node run-experiments.mjs --methods=A,C,F --dom --start=30 --out=raw2
node analyze.mjs                                    # results/summary.json

# 4. Server baseline (Method I)
backend/.venv/bin/python scripts/transcript-rnd/server-baseline.py --limit 60 --save-transcripts
node analyze-server.mjs
node compare.mjs

# 5. Validate the exact production functions end to end
node validate-production-path.mjs aircAruvnKk
```

Regression tests (no network): `cd extension && npx vitest run tests/transcript-rnd`.
