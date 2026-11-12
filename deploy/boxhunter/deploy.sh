#!/usr/bin/env bash
# Publish the game into ./site (served by the web container) and make sure the stack is up.
# Usage: deploy/boxhunter/deploy.sh   (from anywhere)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

# Only the playable files — never .git, tools/ or analysis material.
mkdir -p "$HERE/site"
rsync -a --delete --include='/index.html' --include='/classic.html' --include='/game/***' --exclude='*' \
  "$ROOT/" "$HERE/site/"

cd "$HERE"
docker compose up -d   # no-op if already running with the same config
echo "deployed $(git -C "$ROOT" rev-parse --short HEAD) -> https://www.boxhunter.p-e.kr"
