#!/usr/bin/env bash
# Exit on error
set -o errexit

# Install deps
npm install

# Ensure Chromium/Chrome is installed for Puppeteer
npx puppeteer browsers install chrome
