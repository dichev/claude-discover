#!/bin/bash
# Double-clickable macOS launcher and auto updater (for debug convenience purposes only).
# Every launch resets this checkout to origin/main and rebuilds — local changes are always discarded,
# so keep this copy for running the app, not for working in.
set -e
cd "$(dirname "$0")"

git fetch --quiet origin main
git reset --hard -q HEAD             # drop local edits, so the checkout below can never conflict
git checkout -q -B main origin/main
npm install
npm run build

# macOS hands claude-discover:// links only to .app bundles, so run the app as one: package-mac
# rebuilds the local unsigned bundle when it's stale and registers it as the scheme's handler.
node test/scripts/package-mac.mjs
open dist/claude-discover.app
