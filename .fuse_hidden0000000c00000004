#!/bin/bash
# Oasis Preschool Academy - double-click to start the website and the school management app.
# Keep this window open while you use it. Close it (or press Ctrl+C) to stop.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is needed to run the school app, and it is not installed on this Mac."
  echo "  1. Open https://nodejs.org and download the LTS version (22 or newer)."
  echo "  2. Install it, then double-click this file again."
  echo ""
  open "https://nodejs.org/en/download"
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "  Note: Node.js $NODE_MAJOR found. Version 22.5 or newer is recommended (it includes the SQLite database)."
  echo "  The app will still run and keep data in data/oasis.json."
fi

# use port from config.json (default 8000); move up if that port is busy
PORT=$(node -p "try{require('./config.json').port||8000}catch(e){8000}")
while lsof -ti tcp:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT+1)); done
URL="http://localhost:$PORT"

PORT=$PORT node server.js &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT

OK=""
for _ in $(seq 1 30); do
  if curl -fsS --max-time 1 "$URL/" >/dev/null 2>&1; then OK=1; break; fi
  kill -0 $PID 2>/dev/null || break
  sleep 0.5
done

if [ -n "$OK" ]; then
  printf '\033[1;32m  Open:  %s   (staff login: %s/#/login)\033[0m\n' "$URL" "$URL"
  echo "  Keep this window open. Close it to stop."
  echo ""
  open "$URL"
  wait $PID
else
  echo ""
  echo "  The server could not start. See the message above."
fi
echo ""
read -n 1 -s -r -p "The website has stopped. Press any key to close."
