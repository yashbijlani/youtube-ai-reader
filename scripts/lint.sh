#!/usr/bin/env bash
# Lint/typecheck backend and extension.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== backend lint (ruff) =="
cd "$ROOT/backend"
.venv/bin/python -m ruff check app tests

echo
echo "== extension typecheck (tsc) =="
cd "$ROOT/extension"
npx tsc --noEmit
