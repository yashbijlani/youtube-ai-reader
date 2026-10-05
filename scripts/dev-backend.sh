#!/usr/bin/env bash
# Start the backend for local development.
set -euo pipefail
cd "$(dirname "$0")/../backend"

if [ ! -d ".venv" ]; then
  echo "Creating virtualenv..."
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi

if [ ! -f ".env" ]; then
  echo "No backend/.env found — copying .env.example."
  echo "Edit it and set OPENCODE_API_KEY, then re-run."
  cp .env.example .env
  exit 1
fi

exec .venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port "${PORT:-8000}"
