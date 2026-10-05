# Production Migration Report

Transforming the YouTube AI Reader prototype into a production SaaS, while
preserving the product UX. This report records what changed, the final
architecture, and what remains before launch.

Test counts at completion: **191 backend tests, 63 extension tests, typecheck
clean, extension production + R&D builds pass, Docker image builds and serves
`/api/health`.**

---

## 1. Original architecture

```
Chrome extension ──X-Install-Id──▶ FastAPI (single container, no DB)
  content script / side panel        ├─ yt-dlp transcript (primary)
  MAIN-world caption fetch           ├─ filesystem JSON cache (authoritative)
  ExtPay (client-gated)              ├─ OpenAI-compatible AI (OpenCode/Gemini/…)
  install-id free limit (3)          ├─ in-memory rate limits + install-id usage
                                     └─ in-memory metrics
```

Prototype weaknesses: filesystem was the source of truth; identity/entitlement
trusted the client (`X-Install-Id`, ExtensionPay); provider/model config drifted
across OpenRouter/DeepSeek/Gemini; direct timedtext fetching was dead; no
accounts, no server-side quotas, no billing verification, no deployment story.

## 2. Final architecture

```
Chrome MV3 extension
  ├─ MAIN-world caption interception (primary transcript)
  ├─ rendered-caption DOM fallback
  └─ Supabase Auth session ──JWT──▶ FastAPI on Cloud Run
                                       ├─ Gemini (native API, Lite/Flash routing)
                                       ├─ Supabase Postgres (+ Auth + RLS)
                                       ├─ Razorpay orders/webhooks
                                       └─ yt-dlp fallback ──▶ YouTube
Cloudflare (DNS/TLS/WAF) in front of Cloud Run.
```

Key properties: stateless backend, canonical YouTube videos shared across users,
server-authoritative identity/entitlement/quota, authoritative AI token/cost
accounting, verified payments.

## 3. Files changed (high level)

- `backend/app/config.py` — single authoritative settings (Gemini/Supabase/Razorpay/quotas/pricing).
- `backend/app/services/ai/` — new package: `base.py`, `gemini.py`, `openai_compat.py`, `routing.py`, `usage.py`.
- `backend/app/services/store/` — new package: `base.py`, `supabase_client.py`, `supabase_store.py`, `memory_store.py`.
- `backend/app/services/auth.py`, `quota.py`, `billing.py` — new services.
- `backend/app/services/video_service.py` — canonical-store hydration/persistence, usage context.
- `backend/app/services/reader.py` — request-type routing + usage callbacks.
- `backend/app/main.py` — store/auth/provider wiring, auth middleware, security headers, prod guardrails.
- `backend/app/api/routes.py` — `/me*`, `/billing/*`; server-side quota enforcement; legacy entitlement route removed.
- `backend/app/models/schemas.py` — `VerifyPaymentRequest`, method on ingest, token/cost stats.
- `supabase/migrations/0001_init.sql`, `0002_quota_functions.sql` — schema + atomic quota RPCs.
- `extension/src/lib/auth.ts`, `billing.ts`, `hooks/useAuth.ts`, `hooks/useEntitlement.ts`, `lib/api.ts` — auth/billing/API client.
- `extension/src/background.ts` — production `BrowserTranscriptProvider`, ExtPay removed.
- `extension/src/components/SettingsSheet.tsx` — account section.
- `extension/public/manifest.json` — Supabase/Razorpay permissions, CSP, ExtensionPay removed.
- `backend/Dockerfile`, `scripts/deploy-cloudrun.sh`, `docs/deployment.md` — deployment.
- Tests: `test_gemini_provider.py`, `test_ai_usage.py`, `test_store.py`, `test_auth.py`, `test_quota.py`, `test_billing.py`, `test_security.py`, `test_e2e_flow.py`.

## 4. Database schema

`supabase/migrations/0001_init.sql`:

| Table | Purpose | Key constraints |
|---|---|---|
| `users` | profile mirror of `auth.users` | `id uuid pk`, `plan` |
| `devices` | extension install ids | `install_id pk`, `user_id fk` |
| `videos` | canonical video + status | `id text pk`, status check |
| `transcripts` | one transcript per video | `video_id pk fk`, segments jsonb |
| `video_chunks` | timestamped chunks | `(video_id, idx) pk` |
| `video_analysis` | canonical guide | `video_id pk fk` |
| `ai_usage` | per-call tokens/cost | indexes on user/video/created |
| `used_videos` | lifetime distinct videos | `(user_id, video_id) pk` |
| `usage_periods` | monthly counters | `(user_id, period) pk` |
| `subscriptions` | entitlement state | `user_id unique`, status check |
| `webhook_events` | idempotency | `id pk` |
| `chat_sessions`/`chat_messages` | server-side chat storage | session unique per user+video |

RLS: user-owned rows readable only by `auth.uid()`; canonical video tables are
readable by authenticated users. The backend uses the service-role key and
bypasses RLS for writes.

## 5. API changes

New/updated:

```
GET  /api/me                      account + subscription + usage (authoritative)
GET  /api/me/usage
POST /api/me/device               link install id to the signed-in user
POST /api/billing/create-order
POST /api/billing/verify
GET  /api/billing/subscription
POST /api/billing/webhook         signature-verified, idempotent (public)
```

Existing product routes preserved (`/api/videos/process`, `/{id}/ingest`,
`/{id}/chat`, `/{id}/summarize`, `/{id}/analysis/stream`, transcript, repair,
reprocess, cancel). Removed: client-gated `POST /api/entitlement`.

## 6. Authentication flow

```
Extension signs in (Supabase REST) -> stores session in chrome.storage.local
  -> getAccessToken() refreshes 60s before expiry
  -> every API call sends Authorization: Bearer <jwt> + X-Install-Id
Backend auth middleware:
  verifies JWT (HS256 secret or JWKS) -> request.state.user_id = sub
  AUTH_REQUIRED=true rejects missing/invalid tokens
  ensures the profile row + links the device (best effort)
```

A client cannot choose a user id; the token subject is the only identity. The
install id is a device label and a local (development) usage fallback only.

## 7. Billing flow

```
POST /billing/create-order -> Razorpay order (server credentials)
Razorpay Checkout (extension) -> payment
POST /billing/verify(order_id, payment_id, signature)
  -> HMAC_SHA256(order_id|payment_id, key_secret) verified server-side
  -> subscriptions.status = ACTIVE, period end set
Razorpay webhooks -> /billing/webhook
  -> verified with webhook secret; deduplicated by event id (webhook_events)
  -> payment.captured/order.paid/subscription.* update subscription state
```

Statuses: `FREE | ACTIVE | PAST_DUE | CANCELLED | EXPIRED`. Expired periods are
self-healed on read. A duplicate webhook returns `{duplicate: true}`.

## 8. Quota model

- Free users: `FREE_VIDEO_LIMIT` lifetime distinct videos and
  `FREE_MONTHLY_VIDEO_LIMIT` per calendar month; `FREE_MONTHLY_CHAT_LIMIT` chat
  messages/month.
- `ACTIVE` subscriptions bypass free limits (fair-use bounds are simple guards).
- Consumption is atomic in Postgres (`consume_video_quota`,
  `consume_chat_quota`), locking the user row so concurrent requests cannot race
  past the last slot. The concurrency test proves 10 parallel requests yield
  exactly the limit.
- `/me` exposes authoritative usage for UI; enforcement never depends on it.

## 9. Gemini routing

| Request type | Tier | Model |
|---|---|---|
| preflight, classification, summary, analysis (overview+chapters) | fast | `GEMINI_MODEL_FAST` |
| guide (detailed reading), chat | main | `GEMINI_MODEL_MAIN` |

Every response uses Gemini's authoritative `usageMetadata`
(prompt/candidates tokens); cost is estimated from configured per-model prices
and recorded per call (user, video, request type, latency, success). Chat sends
only BM25-retrieved chunks, never the full transcript.

## 10. Transcript architecture

```
MAIN-world interception of YouTube's own signed caption request (primary)
        ↓ failure
rendered-caption DOM capture (lossy)
        ↓ failure
server yt-dlp + youtube-transcript-api (paced, fallback)
        ↓ failure
unsupported
```

Direct timedtext fetching was removed; the R&D chain is unchanged in spirit and
now fully productionized (`BrowserTranscriptProvider`, `toClientPayload`, ingest
`method` observability). Measured in R&D: interception succeeded on 41/42
captioned videos (97.6%), 100% timestamped, median ~5.5s.

## 11. Deployment architecture

- Stateless container (`backend/Dockerfile`): non-root, ffmpeg, healthcheck,
  `DATA_DIR=/tmp/yair-data` (cache only), `PORT` from Cloud Run.
- Secrets via Google Secret Manager (`GEMINI_API_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`,
  `RAZORPAY_WEBHOOK_SECRET`, …).
- `scripts/deploy-cloudrun.sh` (non-destructive) and `docs/deployment.md` cover
  Supabase migrations, Cloud Run, Cloudflare proxy/WAF/SSE, Razorpay webhook,
  extension build and post-deploy verification.
- Supabase Postgres survives container replacement; no filesystem dependency.

## 12. Security model

- Identity: verified Supabase JWT only; client cannot impersonate (test).
- Entitlement: database subscription state only; legacy client-gated route
  removed (test).
- Quotas: atomic server-side reservation (concurrency test).
- Billing: HMAC signatures for checkout and webhooks; idempotent webhooks.
- Transcript ingestion can be disabled (`TRUST_CLIENT_TRANSCRIPTS`); the
  MAIN-world interceptor only reads `/api/timedtext` response bodies — never
  cookies, auth headers, or unrelated traffic; postMessage bridge validates
  source/token/type.
- yt-dlp runs only on validated 11-char video ids, with argument arrays (no
  shell); injection attempts are rejected in tests.
- Security headers (`nosniff`, `DENY`, `no-referrer`); production
  misconfiguration warnings; secrets never logged or shipped to the extension.

## 13-14. Tests run / counts

| Suite | Count | Notes |
|---|---:|---|
| Backend pytest | **191** | includes auth, quota concurrency, billing signatures/webhooks, store, Gemini routing/cost, security, E2E flow |
| Extension vitest | **63** | transcript R&D + auth session + existing UI/API/markdown/format |
| TypeScript `tsc --noEmit` | clean | |
| Extension build / R&D build | pass | |
| Docker build + container `/api/health` | pass | ran in this environment |

Commands: `scripts/test.sh`, `scripts/lint.sh`, `node scripts/deploy-cloudrun.sh`
(preview only — not run against real cloud projects).

## 15. Known limitations

- **External services were not reachable here.** Supabase, Gemini, Razorpay and
  Cloud Run were exercised with fakes/mocks (MockTransport, MemoryStore,
  HS256 JWT). Real-project integration must be verified at deploy time (see
  `docs/deployment.md` checklist).
- **Billing is a one-time order per paid period**, not an auto-renewing Razorpay
  Subscription. The webhook handler already understands subscription events, but
  plan creation is manual.
- **Server-side chat persistence** exists in the schema/store but the extension
  still uses IndexedDB; server rows are not yet written per message.
- **Chromium bot detection** can suppress captions for automated sessions; the
  interceptor is designed for real user browsers.
- yt-dlp fallback remains rate-limited (measured 65% success under automation);
  it is intentionally last in the chain.
- In-memory rate limiting is per instance; a multi-instance deployment should
  move rate limiting to Cloudflare or a shared store (Redis) if needed.

## 16. Remaining launch blockers

1. Run `supabase db push` against the production project and verify RLS.
2. Set real secrets in Secret Manager and deploy with `AUTH_REQUIRED=true`,
   `TRUST_PROXY=true`, `STORAGE_BACKEND=supabase`.
3. Configure the Razorpay webhook URL and test a real (test-mode) payment.
4. Publish the extension with the production API URL, Supabase anon key, and
   narrowed `host_permissions`/CORS origin.
5. Verify SSE streaming and JWT refresh through Cloudflare end to end.
6. Decide whether to migrate chat persistence to the server tables.
