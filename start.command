#!/bin/bash
# Double-clickable macOS launcher and auto updater (for debug convenience purposes only).
# Every launch resets this checkout to origin/main and rebuilds if it moved — local changes are always discarded,
# so keep this copy for running the app, not for working in.
set -e
cd "$(dirname "$0")"
# bash login shells skip .zshrc, where nvm puts node on PATH (|| true: nvm.sh fails when no default is set)
[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ] && . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" || true

if git fetch --quiet origin main; then
  git diff --quiet origin/main || stale=1   # new commits or local edits — either way the checkout below changes files
  git checkout -qf -B main origin/main      # -f discards local edits, so this can never conflict
else
  echo "Offline — starting the last build"
fi

if [ -n "$stale" ] || [ ! -d out ]; then
  rm -rf out dist
  npm install
  npm run build
else
  echo "Up to date"
fi

# Detached from the Terminal, with PATH, restarting a running copy (attached fallback if open can't)
open -n node_modules/electron/dist/Electron.app --env "PATH=$PATH" --args "$PWD" --restart || npm start -- --restart
