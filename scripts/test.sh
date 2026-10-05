#!/usr/bin/env bash
# Run all automated tests (backend + extension).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== backend tests =="
cd "$ROOT/backend"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements-dev.txt
fi
.venv/bin/python -m pytest -q

echo
echo "== extension tests =="
cd "$ROOT/extension"
if [ ! -d "node_modules" ]; then
  npm install
fi
npx vitest run
