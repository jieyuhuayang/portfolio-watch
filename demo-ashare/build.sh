#!/bin/sh
# Build single-file deployables from the shared judgment module.
#   dist/index.js  — live producer (deploy to ~/feeds/portfolio-watch-ashare/v1/src/index.js)
#   dist/replay.js — one-shot replay  (run via: alva run --local-file dist/replay.js)
# The platform runtime loads one file; node (tests, replay dev) requires
# judgment.js directly. Same judgment bytes in every consumer.
set -e
cd "$(dirname "$0")"
mkdir -p dist
{
  echo "// AUTO-BUILT by demo-ashare/build.sh — do not edit; edit judgment.js / live-body.js"
  cat judgment.js
  cat live-body.js
} > dist/index.js
{
  echo "// AUTO-BUILT by demo-ashare/build.sh — do not edit; edit judgment.js / replay-body.js"
  cat judgment.js
  cat replay-body.js
} > dist/replay.js
node --check dist/index.js
node --check dist/replay.js
echo "built: dist/index.js ($(wc -l < dist/index.js | tr -d ' ') lines), dist/replay.js ($(wc -l < dist/replay.js | tr -d ' ') lines)"
