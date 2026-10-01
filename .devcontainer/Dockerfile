FROM node:24.21.0-bookworm

# Native PTY, flock and Landlock builds use the same toolchain in Codespaces and CI.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       git build-essential python3 musl-tools pkg-config ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json /tmp/dsh930-package.json
RUN manager="$(node -p "require('/tmp/dsh930-package.json').packageManager.split('+')[0]")" \
    && test "$manager" = 'pnpm@12.8.1' \
    && npm install --global "$manager" \
    && test "$(pnpm --version)" = '12.8.1' \
    && rm /tmp/dsh930-package.json

ENV DSH_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=6144
USER node
