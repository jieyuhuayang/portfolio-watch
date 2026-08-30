#!/bin/sh
# Build the single-file deployable from the shared judgment module.
#   dist/index.js — live producer (deploy to ~/feeds/portfolio-watch-crypto-book/v1/src/index.js)
# The platform runtime loads one file; node (tests) requires judgment.js
# directly. Same judgment bytes in every consumer.
set -e
cd "$(dirname "$0")"
mkdir -p dist
{
  echo "// AUTO-BUILT by demo-crypto-book/build.sh — do not edit; edit judgment.js / live-body.js"
  cat judgment.js
  cat live-body.js
} > dist/index.js
node --check dist/index.js
echo "built: dist/index.js ($(wc -l < dist/index.js | tr -d ' ') lines)"
