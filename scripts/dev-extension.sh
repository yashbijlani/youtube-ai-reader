#!/usr/bin/env bash
# Build the extension and watch for changes.
set -euo pipefail
cd "$(dirname "$0")/../extension"

if [ ! -d "node_modules" ]; then
  npm install
fi

exec npm run watch
