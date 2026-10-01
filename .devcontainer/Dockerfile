FROM node:24.21.0-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       git build-essential python3 musl-tools pkg-config ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json /tmp/dsh930-package.json
RUN manager="$(node -p "require('/tmp/dsh930-package.json').packageManager.split('+')[0]")" \
    && npm install --global "$manager" \
    && rm /tmp/dsh930-package.json

USER node
