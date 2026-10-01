#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
node .devcontainer/check-env.mjs
if [[ ! -f .artifacts/dsh930-development/READY.json ]]; then
  echo 'Run bash .devcontainer/setup.sh successfully before starting development.' >&2
  exit 1
fi
export DSH_TELEMETRY_DISABLED=1
exec pnpm run dev:web --skip-build --no-open --port 3080 "$@"
