#!/usr/bin/env bash
set -euxo pipefail

# Ensure cache dir exists (writable in Render)
export PUPPETEER_CACHE_DIR=${PUPPETEER_CACHE_DIR:-/opt/render/.cache/puppeteer}
mkdir -p "$PUPPETEER_CACHE_DIR"

# Install deps; allow Puppeteer to download Chromium
npm ci
# If your project uses yarn/pnpm, use that instead.
