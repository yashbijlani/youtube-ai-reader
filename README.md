# YouTube AI Reader

Turn any YouTube video into a **readable, searchable, askable** AI experience.

Open a video, click **✨ Read with AI**, and Chrome's Side Panel opens with a
structured reading guide: a one-paragraph explanation, key ideas with
timestamps, generated chapters, a searchable timestamped transcript, and a chat
that answers questions grounded in the transcript — with clickable timestamps
that seek the real YouTube player.

The product is a real SaaS: **Supabase accounts + persistence**, **server-side
quotas**, **Razorpay billing**, and a **stateless FastAPI backend on Cloud Run**
talking to **Google Gemini**. Secrets (Gemini, Supabase service role, Razorpay)
live only on the server.

```
┌──────────────────────── Chrome MV3 extension ────────────────────────┐
│ content script (button, SPA nav, seek)                               │
│ background worker ── MAIN-world caption interception (primary)       │
│ side panel (React) ── Supabase Auth JWT ── SSE ── IndexedDB chat     │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
                    Cloudflare (TLS, WAF, proxy)
                                ▼
                    FastAPI on Cloud Run (stateless)
        ┌───────────────┬───────────────┬────────────────┐
        ▼               ▼               ▼                ▼
     Gemini        Supabase        Razorpay          yt-dlp
  (Lite/Flash)  (Postgres+Auth)  (orders/webhooks)  (fallback)
```

## Features

All original product features are preserved:

- Native-looking **Read with AI** button that survives SPA navigation.
- Side Panel with Overview / Chapters / Transcript / Chat tabs.
- **Chat-first**: start asking or hit **Summarize this video** as soon as the
  transcript is ready, before the guide finishes.
- Streamed guide: quick-read, overview, chapters, then the detailed reading
  **token-by-token** over SSE, with Cancel.
- Grounded chat with per-video conversations, BM25 retrieval and clickable
  timestamp citations.
- Two-phase processing: transcript+retrieval first, guide in the background.
- Fast/quality Gemini routing; self-healing retries and repair.

Production additions:

- **Accounts** (Supabase Auth) with persistent sessions and token refresh.
- **Server-side quotas** enforced atomically in Postgres.
- **Razorpay** checkout and signature-verified, idempotent webhooks.
- **Canonical video cache**: one transcript + one analysis per video, shared by
  every user (the main AI cost lever).
- **AI cost accounting** per user/video/request type, from Gemini's own token
  usage.
- **Browser-first transcripts**: MAIN-world interception of YouTube's own
  caption request (R&D-verified, 97.6% of captioned videos), with DOM and
  server yt-dlp fallbacks.

## Repository layout

```
backend/                 FastAPI app
  app/
    api/routes.py          HTTP API (+ /me, /billing)
    config.py              one authoritative settings object
    models/schemas.py
    services/
      ai/                  GeminiProvider, routing, cost/usage
      store/               Supabase + in-memory persistence
      auth.py quota.py billing.py
      reader.py video_service.py transcript.py subtitles.py
      chunking.py retrieval.py cache.py rate_limit.py metrics.py
    main.py                app factory, auth middleware, security headers
  tests/                   191 tests
  Dockerfile               Cloud Run image (non-root)
supabase/migrations/       schema + atomic quota functions
extension/                 Chrome MV3 (React + TS + Vite)
  src/lib/auth.ts billing.ts api.ts      Supabase Auth + Razorpay + API client
  src/transcript-rnd/                    browser transcript provider (primary)
  src/components/ hooks/                 side panel UI
  tests/                   63 tests
scripts/                   dev/test/lint + deploy-cloudrun.sh + transcript R&D
docs/                      deployment.md, production-migration-report.md,
                           transcript-architecture.md, transcript-rnd-results.md
```

## Prerequisites

- Python 3.12+, Node 20+, ffmpeg, Chrome 116+.
- A Gemini API key.
- For full production features: a Supabase project and Razorpay account.
- Local development works without Supabase/Razorpay (in-memory store; billing
  disabled; `AUTH_REQUIRED=false`).

## Quick start (local)

### 1. Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env          # set GEMINI_API_KEY at minimum
.venv/bin/uvicorn app.main:app --reload --port 8000
curl http://127.0.0.1:8000/api/health
```

Optional local Supabase/Razorpay: fill the corresponding variables. With no
Supabase configured the backend uses an in-memory store (development only).

### 2. Extension

```bash
cd extension
npm install
cp .env.example .env          # VITE_API_BASE_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run build                 # extension/dist
```

### 3. Load in Chrome

`chrome://extensions` → Developer mode → **Load unpacked** → `extension/dist`.
Open a YouTube watch page and click **✨ Read with AI**.

## Testing & linting

```bash
scripts/test.sh     # backend pytest + extension vitest
scripts/lint.sh     # ruff + tsc
```

## API (selected)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | public | status + configured model |
| GET | `/api/me` | JWT | account, subscription, authoritative usage |
| GET | `/api/me/usage` | JWT | quota usage only |
| POST | `/api/me/device` | JWT | link the extension install id |
| POST | `/api/billing/create-order` | JWT | create a Razorpay order |
| POST | `/api/billing/verify` | JWT | verify payment signature, activate |
| GET | `/api/billing/subscription` | JWT | normalized subscription status |
| POST | `/api/billing/webhook` | signature | Razorpay events (idempotent) |
| POST | `/api/videos/process` | JWT | start processing (quota enforced) |
| POST | `/api/videos/{id}/ingest` | JWT | browser-captured transcript |
| GET | `/api/videos/{id}` | JWT | full state (status/analysis) |
| GET | `/api/videos/{id}/analysis/stream` | JWT | SSE guide stream |
| POST | `/api/videos/{id}/chat` | JWT | grounded chat (SSE or JSON) |
| POST | `/api/videos/{id}/summarize` | JWT | streamed summary |
| POST | `/api/videos/{id}/repair` | JWT | regenerate the guide |

Authenticated requests send `Authorization: Bearer <supabase-jwt>` (the
extension does this automatically) and `X-Install-Id` as a device label.

## Configuration

Every tunable lives in one place (`backend/app/config.py`) and is documented in
`backend/.env.example`. Groups: runtime, Gemini (`GEMINI_*`), Supabase
(`SUPABASE_*`), Razorpay (`RAZORPAY_*`), quotas (`FREE_*`), server/CORS,
transcripts and yt-dlp, rate limits, analysis sizing. Legacy `OPENCODE_*` names
are accepted as aliases.

## Production deployment

See **[docs/deployment.md](docs/deployment.md)**. Summary:

1. Apply `supabase/migrations/*.sql`; collect URL + keys + JWT secret.
2. Create Secret Manager entries (Gemini, Supabase service role, Razorpay).
3. `GCP_PROJECT=… scripts/deploy-cloudrun.sh`.
4. Put Cloudflare in front (TLS/WAF/rate limits; SSE-safe).
5. Add your API origin to the extension manifest and set the production
   `VITE_*` values; tighten `CORS_ALLOW_ORIGIN_REGEX` to your extension id.
6. Configure the Razorpay webhook at `/api/billing/webhook`.

## Security model

- Supabase JWT is the only identity; the backend verifies it and derives the
  user id from the token subject. Install ids are device labels, not security.
- Entitlement and quotas come from the database; the client cannot grant itself
  Premium or extra videos.
- Razorpay checkout and webhooks are signature-verified; webhooks are
  idempotent by event id.
- `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and Razorpay secrets never ship
  in the extension and are never logged.
- The browser caption interceptor is narrowly scoped to `/api/timedtext`
  responses and reads no cookies, auth headers or unrelated traffic.
- yt-dlp runs only on validated YouTube video ids with argument arrays.

## Transcript strategy

Browser-first, verified by the R&D spike
(`docs/transcript-rnd-results.md`): MAIN-world interception of the player's own
signed caption request succeeded on **97.6%** of captioned videos with full
timestamps (median ~5.5s). The chain is interception → rendered-caption DOM →
server yt-dlp → unsupported. Corpus-level Method I comparison is in the report.

## Roadmap

- Migrate chat persistence to the server `chat_sessions`/`chat_messages` tables.
- Auto-renewing Razorpay Subscriptions (webhook handling already present).
- Vector retrieval behind the existing `ChunkIndex` seam if BM25 proves
  insufficient.
- Shared/distributed rate limiting for multi-instance deployments.

Previously documented limitations and the full migration summary are in
`docs/production-migration-report.md`.
