#!/bin/bash
# Auto-pull script - runs in background and pulls from git every 10 minutes
# Usage: ./auto-pull.sh &
#        OR: nohup ./auto-pull.sh &
#
# To view logs: tail -f .git-auto-pull.log
# To stop:      pkill -f "auto-pull.sh"

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

LOG_FILE="$PROJECT_DIR/.git-auto-pull.log"
INTERVAL=600  # 10 minutes in seconds

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🔄 Auto-pull daemon started (interval: $INTERVAL seconds / 10 minutes)" | tee -a "$LOG_FILE"

while true; do
  sleep "$INTERVAL"

  # Log the pull attempt
  {
    echo ""
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 📥 Attempting to pull latest changes..."
  } >> "$LOG_FILE"

  # Pull and capture output (fetch + reset hard to keep remote changes)
  if git fetch origin main >> "$LOG_FILE" 2>&1 && git reset --hard origin/main >> "$LOG_FILE" 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Pull successful" >> "$LOG_FILE"
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ Pull failed (check network)" >> "$LOG_FILE"
  fi
done
