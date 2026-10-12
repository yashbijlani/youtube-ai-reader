# Deployment — Cloudflare + Cloud Run + Supabase + Gemini + Razorpay

```
Chrome Extension
      │  HTTPS (JWT + X-Install-Id)
      ▼
Cloudflare (DNS, proxy, TLS, WAF/rate limiting)
      ▼
Cloud Run  ──►  FastAPI (stateless container)
   ├──────────►  Supabase Postgres + Auth   (authoritative state)
   ├──────────►  Google Gemini API          (AI, server-side key)
   └──────────►  yt-dlp (fallback only)     ──►  YouTube
Razorpay ──webhook──►  Cloud Run /api/billing/webhook
```

The backend is **stateless**: canonical videos live in Supabase, the filesystem
is only a local cache. Scaling or replacing the container never loses state.

---

## 1. Supabase

1. Create a project at https://supabase.com.
2. Apply migrations (either works):
   - CLI: `supabase link --project-ref <ref> && supabase db push`
   - or paste `supabase/migrations/*.sql` into the SQL editor in order.
3. Authentication → Providers → enable **Email**. Decide whether to require
   email confirmation (recommended in production).
4. Collect:
   - Project URL → `SUPABASE_URL`
   - `anon` public key → `SUPABASE_ANON_KEY` (extension build) and backend
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**backend only, secret**)
   - JWT secret (Settings → API → JWT Settings) → `SUPABASE_JWT_SECRET`
     (only needed if the project uses HS256; asymmetric JWKS is used otherwise).

> The service-role key bypasses RLS and must never reach the extension or logs.

## 2. Gemini

Create an API key in Google AI Studio. It is used only by the backend through
`GEMINI_API_KEY`. Models are configured with `GEMINI_MODEL_MAIN` and
`GEMINI_MODEL_FAST`.

## 3. Secret Manager

```bash
for s in GEMINI_API_KEY SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_ANON_KEY \
         SUPABASE_JWT_SECRET RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET; do
  printf '%s' "REPLACE_ME" | gcloud secrets create "$s" --data-file=-
done
# To update later: gcloud secrets versions add GEMINI_API_KEY --data-file=-
```

## 4. Cloud Run

```bash
GCP_PROJECT=my-project GCP_REGION=asia-south1 scripts/deploy-cloudrun.sh
```

The script builds `backend/Dockerfile` and deploys with:

- `ENVIRONMENT=production`, `AUTH_REQUIRED=true`, `TRUST_PROXY=true`
- `STORAGE_BACKEND=supabase`
- `CORS_ALLOW_ORIGIN_REGEX=^chrome-extension://.*$` (tighten to your published id)
- `YTDLP_CONCURRENCY=1`, `YTDLP_MIN_INTERVAL_SECONDS=4`

The container runs as a non-root user, exposes `PORT`, has a `/api/health`
healthcheck, and uses `DATA_DIR=/tmp/yair-data` (ephemeral cache only).

## 5. Cloudflare

Cloudflare provides DNS, TLS, proxying and WAF/rate limiting. It does **not**
run the backend (FastAPI + yt-dlp stay on Cloud Run).

1. Point your API hostname at Cloud Run:
   - Simplest: Cloud Run → *Integrations* → custom domain mapping, or a
     Cloudflare `CNAME` to the `*.run.app` host with the proxy **on**.
2. SSL/TLS mode: **Full (strict)**.
3. Recommended rules:
   - Rate limit: `POST /api/videos/*/chat` and `/api/videos/process`
     (e.g. 60/min per IP) — the backend also rate-limits per identity.
   - WAF managed rules ON; block obvious scanners.
   - Cache rules: bypass cache for `/api/*` (all responses are dynamic/SSE).
4. Ensure SSE is not buffered: the backend sets `X-Accel-Buffering: no`.
   Cloudflare does not buffer SSE by default; verify after deploy.

## 6. Razorpay

1. Create keys in the Razorpay dashboard (test mode first).
2. Add webhook: `https://api.yourdomain.com/api/billing/webhook`
   with secret = `RAZORPAY_WEBHOOK_SECRET`.
   Subscribe to: `payment.captured`, `order.paid`, `payment.failed`,
   `subscription.activated`, `subscription.charged`, `subscription.cancelled`,
   `subscription.halted`.
3. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
   `RAZORPAY_PLAN_AMOUNT` (paise) and `RAZORPAY_PLAN_PERIOD_DAYS`.
4. Webhooks are idempotent (deduplicated by event id) and signature-verified;
   never enable entitlement from the client alone.

The current checkout is a one-time order granting a paid period
(`RAZORPAY_PLAN_PERIOD_DAYS`, default 30). Renewal is a new order; the webhook
handler also understands Razorpay Subscriptions events if you switch to a
subscription plan.

## 7. Extension build

```bash
cd extension
cp .env.example .env
# VITE_API_BASE_URL=https://api.yourdomain.com
# VITE_SUPABASE_URL=https://<ref>.supabase.co
# VITE_SUPABASE_ANON_KEY=<anon key>
npm install
npm run build   # extension/dist
```

`extension/public/manifest.json` already allows `https://*.supabase.co/*`,
`https://api.razorpay.com/*` and `https://checkout.razorpay.com/*`. Add your API
origin to `host_permissions` before shipping a real domain, and tighten
`CORS_ALLOW_ORIGIN_REGEX` to your published extension id.

## 8. Post-deploy verification

```bash
curl https://api.yourdomain.com/api/health
# {"status":"ok",...,"ai_configured":true,"model":"gemini-3.8-flash"}
curl -H "Authorization: Bearer <jwt>" https://api.yourdomain.com/api/me
```

Checklist:
- [ ] `/api/health` returns `ai_configured: true`
- [ ] `/api/me` returns account + usage for a signed-in user
- [ ] Processing a video persists rows in `videos`/`transcripts`/`ai_usage`
- [ ] A second user opening the same video is served from the canonical store
- [ ] Free quota blocks the 4th video in a month with `quota_exceeded`
- [ ] Razorpay test payment activates `subscriptions.status = ACTIVE`
- [ ] Webhook retries are idempotent (no duplicate activation)
- [ ] SSE chat streams through Cloudflare

## 9. Rollback

Cloud Run keeps revisions:

```bash
gcloud run revisions list --service youtube-ai-reader-api --region asia-south1
gcloud run services update-traffic youtube-ai-reader-api \
  --region asia-south1 --to-revisions <previous-revision>=100
```

Database changes are additive (new tables/functions); the previous revision
tolerates the newer schema.
