#!/bin/bash
# Double-clickable macOS launcher and auto updater (for debug convenience purposes only).
# Every launch resets this checkout to origin/main and rebuilds if it moved — local changes are always discarded,
# so keep this copy for running the app, not for working in.
set -e
cd "$(dirname "$0")"

git fetch --quiet origin main
git diff --quiet origin/main || stale=1   # new commits or local edits — either way the checkout below changes files
git checkout -qf -B main origin/main      # -f discards local edits, so this can never conflict

if [ -n "$stale" ] || [ ! -d out ]; then
  npm install
  npm run build
fi

npm start
