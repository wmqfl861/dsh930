#!/usr/bin/env bash
# The identical acceptance path is used by postCreateCommand and the container CI job.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p "$HOME" .artifacts/dsh930-development
export DSH_TELEMETRY_DISABLED=1
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}"
results="$PWD/.artifacts/dsh930-development"
rm -f "$results/READY.json"

step() {
  local name="$1"
  shift
  printf '\n== %s ==\n' "$name"
  if "$@" > "$results/$name.log" 2>&1; then
    tail -n 6 "$results/$name.log"
  else
    local status=$?
    tail -n 80 "$results/$name.log"
    printf 'FAILED: %s (exit %s). See %s\n' "$name" "$status" "$results" >&2
    return "$status"
  fi
}

step toolchain node .devcontainer/check-env.mjs
step configuration-tests node --test .devcontainer/check-env.test.mjs
sha256sum pnpm-lock.yaml > "$results/lockfile.sha256"
step install pnpm install --frozen-lockfile
step clean pnpm run clean
# The desktop flock probe needs the platform's complete binary roster, not only glibc.
step native pnpm --dir native/system run build:native
step native-types pnpm --dir native/system run build:ts
step build pnpm run build
step lint pnpm run lint:contracts-ready
step focused pnpm exec vitest run \
  packages/test-support/client-runtime/tests/assembly-bundle-roster.client.spec.ts \
  scripts/primary-runtime/prepare.spec.ts \
  packages/telemetry/otel packages/host/product-telemetry-otel \
  packages/session/session-telemetry-otel \
  packages/core/agent-loop/tests/properties.spec.ts \
  packages/experimental/inspector/tests/worker-lifecycle.host.spec.ts \
  packages/experimental/webworker-runtime/tests/node/shim-diff.spec.ts \
  --maxWorkers=2 --reporter=default --reporter=json --outputFile="$results/focused.json"
step web-smoke node .dsh930/smoke.mjs
sha256sum --check "$results/lockfile.sha256"
node --input-type=module <<'JS'
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const focused = JSON.parse(fs.readFileSync('.artifacts/dsh930-development/focused.json', 'utf8'));
const report = {
  recordedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  node: process.version,
  pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
  lockfileSha256: createHash('sha256').update(fs.readFileSync('pnpm-lock.yaml')).digest('hex'),
  install: 'passed', cleanBuild: 'passed', lint: 'passed', authenticatedWebSmoke: 'passed',
  focusedTests: { passed: focused.numPassedTests, failed: focused.numFailedTests },
  developmentReady: true,
  fullRegression: 'separate-ci-gate',
  modelApiTested: false, productionReady: false,
};
fs.writeFileSync('.artifacts/dsh930-development/READY.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
JS
printf '\nDevelopment baseline verified. Start editing with: bash .devcontainer/start.sh\n'
