#!/usr/bin/env bash
set -euxo pipefail

# Ensure Puppeteer cache dir exists
export PUPPETEER_CACHE_DIR=${PUPPETEER_CACHE_DIR:-/opt/render/.cache/puppeteer}
mkdir -p "$PUPPETEER_CACHE_DIR"

# Install dependencies
npm install

# Download Chromium for Puppeteer
npx puppeteer browsers install chromium
