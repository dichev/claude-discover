#!/bin/bash
# Double-clickable macOS launcher for the app.
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  npm install
fi

npm run build
npm start