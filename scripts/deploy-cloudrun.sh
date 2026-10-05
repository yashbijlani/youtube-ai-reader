#!/usr/bin/env bash
# Deploy the backend to Google Cloud Run.
#
# This script is intentionally non-destructive: it creates/updates a Cloud Run
# service and its secrets' *references*, but never deletes existing resources.
# Review the printed plan and required secrets before running.
#
# Required beforehand (see docs/deployment.md):
#   - Artifact Registry repo, e.g. ${REGION}-docker.pkg.dev/${PROJECT}/yair
#   - Secret Manager secrets matching the --set-secrets list below
set -euo pipefail

PROJECT="${GCP_PROJECT:?set GCP_PROJECT}"
REGION="${GCP_REGION:-asia-south1}"
SERVICE="${SERVICE_NAME:-youtube-ai-reader-api}"
REPO="${ARTIFACT_REPO:-yair}"
TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/backend:${TAG}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Project : ${PROJECT}"
echo "Region  : ${REGION}"
echo "Service : ${SERVICE}"
echo "Image   : ${IMAGE}"
echo

echo "==> Building image"
gcloud builds submit "${ROOT}/backend" --project "${PROJECT}" --tag "${IMAGE}"

echo "==> Deploying to Cloud Run"
gcloud run deploy "${SERVICE}" \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --image "${IMAGE}" \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --concurrency 40 \
  --timeout 300 \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest,SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,SUPABASE_ANON_KEY=SUPABASE_ANON_KEY:latest,SUPABASE_JWT_SECRET=SUPABASE_JWT_SECRET:latest,RAZORPAY_KEY_ID=RAZORPAY_KEY_ID:latest,RAZORPAY_KEY_SECRET=RAZORPAY_KEY_SECRET:latest,RAZORPAY_WEBHOOK_SECRET=RAZORPAY_WEBHOOK_SECRET:latest" \
  --set-env-vars "ENVIRONMENT=production,AUTH_REQUIRED=true,TRUST_PROXY=true,STORAGE_BACKEND=supabase,TRUST_CLIENT_TRANSCRIPTS=true,AI_PROVIDER=gemini,GEMINI_MODEL_MAIN=gemini-3.8-flash,GEMINI_MODEL_FAST=gemini-3.5-flash-lite,CORS_ALLOW_ORIGIN_REGEX=^chrome-extension://.*$,YTDLP_CONCURRENCY=1,YTDLP_MIN_INTERVAL_SECONDS=4"

echo "==> Service URL"
gcloud run services describe "${SERVICE}" --project "${PROJECT}" --region "${REGION}" --format='value(status.url)'
