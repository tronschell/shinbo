#!/bin/sh
set -e
cd "$(dirname "$0")"
osascript -e 'quit app "Shinbo"' 2>/dev/null || true
for _ in $(seq 1 15); do
  pgrep -x Shinbo >/dev/null || break
  sleep 1
done
pkill -x Shinbo || true
pkill -x shinbo-cli || true
SHINBO_FAST_BUILD=1 npm run package:mac
open -a "$PWD/desktop/release/Shinbo-darwin-arm64/Shinbo.app"
