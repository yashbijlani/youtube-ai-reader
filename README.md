# YouTube AI Reader

Turn any YouTube video into a **readable, searchable, askable** AI experience.

Open a video, click **✨ Read with AI**, and Chrome's Side Panel opens with a
structured reading guide: a one-paragraph explanation, key ideas with
timestamps, generated chapters, a searchable timestamped transcript, and a chat
that answers questions grounded in the transcript — with clickable timestamps
that seek the real YouTube player.

The API key never touches the browser. The extension only talks to your own
backend, and the backend talks to OpenCode / any OpenAI-compatible model
endpoint.

```
┌──────────────┐   messages    ┌──────────────────┐   HTTP   ┌───────────────────────────┐
│ Content      │──────────────▶│ Background       │          │ Backend (FastAPI)         │
│ script       │◀── SEEK_TO ───│ service worker   │          │                           │
│ (button)     │               │ (state, panel)   │          │  yt-dlp → transcript      │
└──────────────┘               └────────┬─────────┘          │  chunk → retrieve         │
                                        │ runtime messages   │  AIProvider → OpenCode    │
                                ┌───────▼─────────┐  fetch   │  filesystem cache         │
                                │ Side Panel      │─────────▶│  rate limiting            │
                                │ (React + Vite)  │◀─────────│  (API key stays here)     │
                                └─────────────────┘   SSE    └───────────────────────────┘
```

## Features

- **In-page button** that looks native to YouTube, survives SPA navigation, and never duplicates.
- **Side Panel reader** with Overview / Chapters / Transcript / Chat tabs.
- **Chat-first, instant**: the panel lands on Chat as soon as the transcript is ready and you can ask or hit **Summarize this video** immediately.
- **Client-side captions (primary)**: the extension observes the caption request YouTube's own player makes (MAIN-world `XMLHttpRequest` interception) and posts the json3 to the backend — full timestamps, no server-side YouTube scraping, ~5s median, 97.6% of captioned videos in testing. yt-dlp is the fallback.
- **Streamed guide**: a quick-read streams first, then the overview/chapters as events, then the detailed reading **token-by-token** over SSE — with a Cancel button while it works.
- **Real AI analysis** via an OpenAI-compatible endpoint (Gemini by default): overview, key ideas, chapters, and an article-style detailed reading — generated concurrently, with an optional fast model.
- **Self-healing**: transient model errors are retried, failed sections fall back to non-streaming, and a **repair** pass regenerates only the missing parts. Terminal provider errors (no funds / bad key / missing model) fail fast with clear guidance.
- **Grounded chat** with per-video conversations stored in IndexedDB. Only relevant transcript chunks are sent to the model.
- **Clickable timestamps** everywhere (`[17:32]` in prose, chips in lists, citations in chat) that seek the YouTube player.
- **Caching** per video: processing a popular video once serves everybody.
- **Friendly error states** for private/age-restricted/no-caption videos, network failures, provider funding/keys, and malformed model output.

## Repository layout

```
youtube-ai-reader/
├── backend/                 FastAPI app, yt-dlp pipeline, AI reader, tests
│   ├── app/
│   │   ├── api/routes.py         HTTP API
│   │   ├── models/schemas.py     Pydantic schemas
│   │   ├── services/
│   │   │   ├── youtube.py        URL validation / video id extraction
│   │   │   ├── transcript.py     TranscriptProvider + yt-dlp implementation
│   │   │   ├── subtitles.py      VTT/JSON3/TTML parsing + normalisation
│   │   │   ├── chunking.py       timestamp-preserving chunking
│   │   │   ├── retrieval.py      BM25 chunk retrieval (swappable)
│   │   │   ├── ai_provider.py    AIProvider abstraction (OpenAI-compatible)
│   │   │   ├── prompts.py        one prompt per task
│   │   │   ├── reader.py         map-reduce analysis + grounded Q&A
│   │   │   ├── video_service.py  orchestration, jobs, cache
│   │   │   ├── cache.py          filesystem cache (per video)
│   │   │   └── rate_limit.py     per-IP sliding windows
│   │   └── main.py               app factory, CORS, logging, error handlers
│   └── tests/               100 pytest tests
├── extension/               MV3 Chrome extension (React + TypeScript + Vite)
│   ├── src/
│   │   ├── content.ts            button injection, SPA nav, seeking
│   │   ├── background.ts         side panel, message routing, state
│   │   ├── sidepanel.tsx         reader application shell
│   │   ├── components/           Header, tabs, chat, transcript, settings…
│   │   ├── hooks/                video context, reader state, chat
│   │   └── lib/                  api client, IndexedDB store, markdown, format
│   └── tests/               36 vitest tests
├── scripts/                 dev-backend, dev-extension, test, lint
├── docker-compose.yml
└── README.md
```

## Prerequisites

- **Python 3.11+** and `python3-venv`
- **Node.js 20+** and npm
- **ffmpeg** (recommended; yt-dlp uses it for some streams)
- **Chrome 116+** (Side Panel API)
- An **OpenCode API key** (or any OpenAI-compatible endpoint and key)

## Quick start

### 1. Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt     # or requirements.txt for runtime only
cp .env.example .env                              # then edit OPENCODE_API_KEY
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Check it:

```bash
curl http://127.0.0.1:8000/api/health
# {"status":"ok","version":"0.1.0","ai_configured":true,"model":"..."}
```

### 2. Extension

```bash
cd extension
npm install
npm run build          # output in extension/dist
```

### 3. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/dist` folder
5. Pin the extension (optional)

### 4. Use it

1. Open any YouTube watch page, e.g. `https://www.youtube.com/watch?v=aircAruvnKk`
2. Click **✨ Read with AI** next to Like / Share
3. The Side Panel opens and shows live progress stages
4. Read the overview, browse chapters, search the transcript, ask questions
5. Click any timestamp to jump the player

Alternatively, click the toolbar icon to open the panel for the current tab.

## Environment variables

All backend secrets live in `backend/.env` (git-ignored). See
`backend/.env.example` for the full list.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENCODE_API_KEY` | — | **Required.** Server-side only. Never shipped to the browser. |
| `OPENCODE_BASE_URL` | `https://opencode.ai/zen/v1` | OpenAI-compatible base URL (OpenCode Zen, OpenAI, Ollama, vLLM, …) |
| `OPENCODE_MODEL` | `gemini-3.5-flash-lite` | Model id passed to the endpoint |
| `OPENCODE_FAST_MODEL` | same as main | Optional cheaper/faster model for quick-read + overview + chapters |
| `AI_PREFLIGHT_ENABLED` | `true` | Probe the provider before spending a YouTube fetch |
| `TRUST_CLIENT_TRANSCRIPTS` | `true` | Accept transcripts captured by the extension |
| `OVERVIEW_CONTEXT_CHARS` | `14000` | Whole-timeline digest budget for overview/chapters |
| `ANALYSIS_READING_CONCURRENCY` | `4` | Detailed-reading sections written in parallel |
| `YTDLP_CONCURRENCY` | `1` | Serialise YouTube yt-dlp requests |
| `YTDLP_MIN_INTERVAL_SECONDS` | `4` | Minimum spacing between yt-dlp requests |
| `YTDLP_429_MAX_RETRIES` | `1` | Retries on YouTube HTTP 429 before the fallback provider |
| `YTDLP_429_BACKOFF_SECONDS` | `8` | Base backoff for 429 (exponential + jitter) |
| `YTDLP_COOKIES_FILE` | — | Netscape cookies file to reduce throttling |
| `YTDLP_COOKIES_FROM_BROWSER` | — | Read cookies from a server browser profile |
| `TRANSCRIPT_FALLBACK_ENABLED` | `true` | Use `youtube-transcript-api` when yt-dlp is throttled |
| `LOG_POLL_REQUESTS` | `false` | Log every state poll (off keeps logs quiet) |
| `OPENCODE_TIMEOUT_SECONDS` | `240` | Per-request timeout |
| `OPENCODE_MAX_CONCURRENCY` | `4` | Concurrent model calls |
| `MAX_CONCURRENT_JOBS` | `3` | Concurrent video processing jobs |
| `MAX_TRANSCRIPT_CHARS` | `900000` | Reject absurdly large transcripts (~10h+) |
| `CACHE_ENABLED` | `true` | Filesystem cache for transcripts + analysis |
| `DATA_DIR` | `backend/data` | Cache/data directory |
| `CORS_ALLOW_ORIGIN_REGEX` | dev regex | Allowed browser origins; set explicitly in production |
| `RATE_LIMIT_PROCESS_PER_HOUR` | `10` | Per-IP processing rate limit |
| `RATE_LIMIT_CHAT_PER_HOUR` | `60` | Per-IP chat rate limit |
| `TRUST_PROXY` | `false` | Set `true` behind a reverse proxy to use `X-Forwarded-For` |

### Choosing a provider (and billing)

The backend speaks the standard **OpenAI chat-completions protocol**, so almost
any provider works. The `OPENCODE_*` env vars are generic:

**Google Gemini (default, fast and free tier available)**
```
OPENCODE_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
OPENCODE_API_KEY=<Google AI Studio key>
OPENCODE_MODEL=gemini-3.5-flash-lite
OPENCODE_FAST_MODEL=gemini-3.5-flash-lite
```

**OpenCode Zen**
```
OPENCODE_BASE_URL=https://opencode.ai/zen/v1
OPENCODE_API_KEY=<Zen key>
OPENCODE_MODEL=glm-5.3-flash
```

**Local (Ollama, vLLM, LM Studio)** — e.g. `http://127.0.0.1:11434/v1`.

Notes:
- The provider layer (`AIProvider` / `OpenAICompatibleProvider` in
  `backend/app/services/ai_provider.py`) is the only place that knows HTTP, so a
  native Gemini/Anthropic provider is one new class.
- **Provider billing matters.** An OpenCode **Go subscription covers usage inside
  the OpenCode client**, not external API-key calls: free Zen models are refused
  outside OpenCode (`403 FreeTierError`) and paid models bill to your
  pay-as-you-go balance (`402 Insufficient account funds` if it is empty). For a
  server you need a funded API key — Gemini, a paid Zen plan with Extra Usage, or
  another provider.
- The backend runs a cheap **preflight** call before spending a YouTube fetch, so
  a bad key, no funds, or a missing model fails fast with a clear message
  (`ai_insufficient_funds`, `ai_access_denied`, `ai_model_unavailable`).
- Reasoning models may need a large output budget; the provider retries empty
  responses with a bigger budget. Some gateways reject `/chat/completions` for
  certain models (`ModelProtocolUnsupported`) — pick one that exposes the OpenAI
  protocol.

### Client-side captions (verified) and the server fallback

The extension captures the video's caption track from the user's own session,
then POSTs it to `/api/videos/{id}/ingest`. The reliable mechanism is **MAIN-world
interception** (R&D report: `docs/transcript-rnd-results.md`):

> YouTube's `timedtext` URL now returns an **empty body** unless it carries a
> proof-of-origin (`pot`) token the player mints internally, so we cannot fetch
> captions ourselves. Instead we patch `XMLHttpRequest`/`fetch` in the page's
> MAIN world and observe the response the player already fetched — which is full
> json3 with timestamps.

Flow: install the interceptor → turn captions on + play so the player issues its
signed request → read the captured json3 → `POST /api/videos/{id}/ingest`. This
worked on **97.6% of captioned videos** in testing (42 sampled), with full
timestamps and a median ~5.5s. The extension silently falls back to **server-side
yt-dlp** (with `youtube-transcript-api`) for videos with no captions, for failed/
partial captures, and as the ultimate safety net.

### Monetization (free previews + ExtensionPay)

- The extension sends a stable anonymous `X-Install-Id`; the backend counts the
  distinct videos it has processed and blocks after `FREE_VIDEO_LIMIT` (default 3)
  with `402 free_limit_reached`.
- **ExtensionPay** (`ExtPay.js`, 5% per transaction, no backend/accounts) handles
  checkout, trials and subscription state; the extension calls
  `POST /api/entitlement` best-effort when the user is paid (client-gated, as
  agreed). Set `VITE_EXTPAY_ID` to the id you register at extensionpay.com and
  connect Stripe there.
- `GET /api/usage` returns `{ used, limit, paid, remaining }`.

### Reducing YouTube throttling (HTTP 429)

For the server-side fallback path, the backend serialises and spaces requests,
retries 429s with backoff, and falls back to `youtube-transcript-api`. For heavy
use, give it cookies:

1. Export your YouTube cookies to a Netscape-format file (many browser
   extensions can do this), e.g. `~/youtube-cookies.txt`.
2. Set `YTDLP_COOKIES_FILE=/home/you/youtube-cookies.txt` (or
   `YTDLP_COOKIES_FROM_BROWSER=firefox` if the server has that browser profile).
3. Restart the backend. Cookies stay server-side and are never sent to the
   extension.

### Extension configuration

- Build-time default: copy `extension/.env.example` to `extension/.env` and set `VITE_API_BASE_URL`.
- Runtime override: the Settings sheet in the side panel (**gear icon → Backend URL**) stores the URL in `chrome.storage.local`.
- `extension/public/manifest.json` grants host permissions for `http://localhost/*` and `http://127.0.0.1/*`. When deploying the backend to a real domain, add that origin to `host_permissions` and rebuild.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Status, model, whether the API key is configured |
| `POST` | `/api/videos/process` | `{ "youtube_url": "...", "force": false }` → state (starts a job; returns cached state instantly when available) |
| `GET` | `/api/videos/{video_id}` | Full state: status, stage, metadata, analysis, error |
| `GET` | `/api/videos/{video_id}/transcript` | Timestamped transcript (`?format=text` for plain text) |
| `POST` | `/api/videos/{video_id}/ingest` | Accept a transcript captured client-side (`{ title, channel, duration, language, kind, format, content }`) |
| `GET` | `/api/videos/{video_id}/analysis/stream` | SSE stream of the guide (quick-read tokens + overview/chapters parts + reading tokens) |
| `POST` | `/api/videos/{video_id}/chat` | `{ "message": "...", "history": [...], "current_time_seconds": 1052, "stream": true }` |
| `POST` | `/api/videos/{video_id}/summarize` | Streaming summary, usable as soon as the transcript is ready |
| `POST` | `/api/videos/{video_id}/reprocess` | Force fresh transcript + analysis |
| `POST` | `/api/videos/{video_id}/repair` | Regenerate only the guide, reusing the transcript |
| `POST` | `/api/videos/{video_id}/cancel` | Cancel an in-flight job |
| `GET` | `/api/stats` | Counters: videos, cache hits, AI calls, chars in/out, by model |

Processing happens in two phases. The process call returns immediately;
the client polls `GET /api/videos/{id}`:

1. **Chat-ready** (`status: "ready"`, `analysis_status: "pending"`) after
   `fetching_metadata → fetching_transcript → preparing`. Chat, transcript and
   the streaming summary work from here.
2. **Guide-ready** (`analysis_status: "ready"`) after the overview, chapters and
   detailed reading are generated. The panel subscribes to
   `/api/videos/{id}/analysis/stream` (SSE) so parts appear as events and the
   reading streams token-by-token; `analysis_status: "partial"` reflects
   progress, and polling is a reconnect fallback.

Chat supports **SSE streaming** (`stream: true`) and automatically falls back
to a non-streaming JSON response.

## Development

```bash
# backend with reload
scripts/dev-backend.sh

# extension build in watch mode (reload extension in chrome://extensions after rebuilds)
scripts/dev-extension.sh

# all tests
scripts/test.sh

# lint + typecheck
scripts/lint.sh
```

### Transcript R&D harness

The browser-side transcript strategy is backed by an isolated experiment harness
(see `docs/transcript-rnd-results.md` and `docs/transcript-architecture.md`):

```bash
# build the debug page (extension/dist/rnd/debug.html)
cd extension && npm run build:rnd

# run the browser extraction experiments (needs Chromium + a display)
cd scripts/transcript-rnd && npm install
node discover-corpus.mjs                 # build a representative corpus
node run-experiments.mjs --methods=A,C,F --dom
node analyze.mjs                         # measured success/latency tables

# server yt-dlp baseline (Method I)
backend/.venv/bin/python scripts/transcript-rnd/server-baseline.py --limit 60
```

Harness code lives in `extension/src/transcript-rnd/`; regression tests in
`extension/tests/transcript-rnd/` (fixtures, no network).

### Tests

- Backend: `cd backend && .venv/bin/python -m pytest` — 137 tests covering URL
  validation, subtitle parsing (VTT/JSON3/TTML), normalisation, chunking,
  retrieval, schemas, malformed AI output, the chat-ready/guide phase split,
  yt-dlp 429 retry/backoff and fallback captions, the analysis SSE stream,
  caching, rate limiting, and the full API flow with fake providers.
- Extension: `cd extension && npx vitest run` — 39 tests covering video id
  extraction, timestamp formatting, API/SSE parsing (chat, summarize, analysis),
  IndexedDB conversation storage, and markdown sanitisation + timestamp
  linkification.
- Real end-to-end: the pipeline was validated against a real public YouTube
  video (`aircAruvnKk`) with real yt-dlp captions and a real OpenCode Zen model:
  **chat-ready in ~8s**, a streaming summary from the transcript alone, and the
  full guide generated in the background (~1-4 min, non-blocking). The built
  extension was exercised in Chromium against real YouTube: button injection,
  SPA-safe duplicates, chat-first landing, panel rendering, transcript search,
  timestamp seeking, grounded chat with citations, and per-video IndexedDB
  persistence.

## Deployment

### Release architecture (hosted backend)

The extension cannot run yt-dlp (no subprocess, CORS, and the model key must stay
secret), so for a release you host one backend and the extension talks to it:

```
Chrome extension ──(client-captured captions + questions)──▶ your backend ──▶ AI provider
                                                              └── yt-dlp fallback + shared cache
```

- **Client-side captions** mean each user's own IP fetches captions, so you are
  not throttled by YouTube at scale; the backend only spends AI.
- **Shared canonical cache**: one processed video serves all users. This is the
  main lever on AI cost.
- **Protect the backend**: rate limits are on by default; for a public release
  add authentication/quota, and set `TRUST_CLIENT_TRANSCRIPTS=false` if you need
  to scope client transcripts per session instead of the shared cache.
- **Funded provider required**: a Go/consumer subscription generally does not
  authorize server-side API calls (see "Choosing a provider"). Use a paid API
  key or a local model.

### Run it

```bash
cd backend
cp .env.example .env   # real key, explicit CORS origin, production model
docker compose up -d --build
```

Or run directly on a Linux box:

```bash
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Production checklist:

- Put the backend behind HTTPS (Caddy/nginx).
- Set `TRUST_PROXY=true` and restrict `CORS_ALLOW_ORIGINS` / `CORS_ALLOW_ORIGIN_REGEX`
  to your extension and site origins instead of the dev regex.
- Add your backend origin to `extension/public/manifest.json` `host_permissions`
  and set the default `VITE_API_BASE_URL`.
- Keep `backend/data` on persistent storage so the cache survives restarts.
- Watch `GET /api/stats` and the `[cost]` log lines for usage.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Can't reach the reader backend" | Start the backend; check the URL in the extension Settings sheet. |
| Button doesn't appear | Reload the YouTube tab after installing; YouTube DOM changes occasionally — the content script falls back across several insertion points. |
| "Couldn't obtain a transcript" | The video has no captions. Speech-to-text is intentionally out of scope for v1. |
| "YouTube is temporarily rate-limiting transcript downloads" | YouTube returned HTTP 429. The backend retries with backoff; if it persists, set `YTDLP_COOKIES_FILE` (exported cookies) or `YTDLP_COOKIES_FROM_BROWSER`, wait a few minutes, and keep `YTDLP_CONCURRENCY=1`. |
| "YouTube blocked the request from this server" | Update yt-dlp (`pip install -U yt-dlp`); datacenter IPs may need cookies. |
| `ai_not_configured` | Set `OPENCODE_API_KEY` in `backend/.env` and restart. |
| "AI service returned an empty response" | The model exhausted its budget on reasoning. Increase `AI_MAX_OUTPUT_TOKENS` or pick another model. |
| Side Panel doesn't open from the button | Click the extension's toolbar icon instead (it opens the panel for the active tab); Chrome requires a user gesture for the first open. |
| CORS error in the panel console | Add your backend origin to `host_permissions` in the manifest and rebuild, or set `CORS_ALLOW_ORIGINS` on the server. |

## Roadmap (next three)

1. **SSE progress channel**: replace the 2s state poll with a server-sent progress stream (and token-level streaming of the detailed reading).
2. **Vector retrieval**: swap the BM25 `ChunkIndex` for embeddings so paraphrased questions retrieve better; the interface already isolates this.
3. **Accounts + shared canonical cache**: one processed video serving many users from a real database, with per-user quotas and cost attribution.

Designed-for later (not implemented): explain-this-section, summarize-from-here,
note-taking, quizzes, translation, multi-video compare, OCR/multimodal.
