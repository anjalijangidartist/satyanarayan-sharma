#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
( sleep 1; xdg-open "http://localhost:${PORT:-4173}" >/dev/null 2>&1 || true ) &
exec node server.js
