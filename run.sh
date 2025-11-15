#!/bin/bash
# Main startup script for ollama-web
# Usage: ./run.sh [--dev] [--pull] [--no-browser]
#
# Options:
#   --dev           Run in development mode with auto-reload (nodemon)
#   --pull          Pull latest changes before starting
#   --no-browser    Don't attempt to open browser
#
# Examples:
#   ./run.sh                    # Start with browser
#   ./run.sh --dev              # Development mode
#   ./run.sh --pull --dev       # Pull + dev mode

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# Parse options
DEV_MODE=false
PULL_FIRST=false
OPEN_BROWSER=true

while [[ $# -gt 0 ]]; do
  case $1 in
    --dev)
      DEV_MODE=true
      shift
      ;;
    --pull)
      PULL_FIRST=true
      shift
      ;;
    --no-browser)
      OPEN_BROWSER=false
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Pull latest changes if requested
if [ "$PULL_FIRST" = true ]; then
  echo "📦 Pulling latest changes from repository..."
  git pull origin main
  echo "✅ Pull complete"
fi

# Install/update dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📥 Installing dependencies..."
  npm install
  echo "✅ Dependencies installed"
fi

# Get the port (default 3000)
PORT=${PORT:-3000}
BASE_URL="http://localhost:$PORT"

echo ""
echo "🚀 Starting ollama-web server..."
echo "📡 Server URL: $BASE_URL"
echo ""

# Start the server
if [ "$DEV_MODE" = true ]; then
  echo "🔄 Development mode (with auto-reload)"
  npm run dev
else
  npm start
fi
