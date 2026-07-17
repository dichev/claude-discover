#!/bin/bash
# Double-clickable macOS launcher and auto updater
set -e
cd "$(dirname "$0")"

if [ -d .git ]; then # Auto updater
  git fetch --quiet origin main
  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse origin/main)
  if [ "$LOCAL" != "$REMOTE" ]; then
    echo "Auto-updating to latest version (origin/main)..."

    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    DIRTY=$(git status --porcelain)
    UNPUSHED=$(git log origin/main..main --oneline 2>/dev/null || true)

    if [ -n "$DIRTY" ] || [ "$BRANCH" != "main" ] || [ -n "$UNPUSHED" ]; then
      echo "Warning: the update will discard your local changes."
      read -r -p "Continue? [Y/n] " REPLY
      if [ "$REPLY" = "n" ] || [ "$REPLY" = "N" ]; then
        echo "Aborted update. Starting app with current code..."
        npm start
        exit 0
      fi
    fi

    git reset --hard HEAD
    git checkout -B main origin/main
    npm install
    npm run build
  fi
fi

if [ ! -d node_modules ]; then
  npm install
  npm run build
fi

# One-time cleanup of the retired capture-context hook + sidecars (marker survives updates)
if [ ! -f .remove-context-logs.ignore.done ]; then
  node bin/remove-context-logs-and-hooks.mjs --force || true
  touch .remove-context-logs.ignore.done
fi

npm start