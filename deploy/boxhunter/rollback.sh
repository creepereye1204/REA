#!/usr/bin/env bash
# Roll the live game back (or forward) to a tagged version.
#   deploy/boxhunter/rollback.sh v2.11          -> www.boxhunter.p-e.kr serves v2.11 immediately
#   deploy/boxhunter/rollback.sh v2.11 --pages  -> also commit those files to main so GitHub Pages follows
#   deploy/boxhunter/rollback.sh --list         -> show the version tags
# Your working tree is never touched unless --pages is given.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"
if [[ "${1:-}" == "--list" || -z "${1:-}" ]]; then git tag -n1 --sort=-v:refname | head -40; exit 0; fi
TAG="$1"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "no such tag: $TAG"; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git archive "$TAG" index.html classic.html game assets 2>/dev/null | tar -x -C "$TMP" || git archive "$TAG" index.html classic.html game | tar -x -C "$TMP"
mkdir -p "$HERE/site"
rsync -a --delete "$TMP/" "$HERE/site/"
chmod -R a+rX "$HERE/site"   # mktemp dirs are private; nginx must read them
echo "boxhunter now serves $TAG ($(git rev-parse --short "$TAG^{commit}"))"
if [[ "${2:-}" == "--pages" ]]; then
  git checkout "$TAG" -- index.html classic.html game assets
  git -c user.name="$(git log -1 --format=%an)" -c user.email="$(git log -1 --format=%ae)" commit -q -m "Roll back game files to $TAG"
  git push -q origin HEAD
  echo "GitHub Pages will follow in a minute"
fi
