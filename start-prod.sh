#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIST_DIR="$ROOT_DIR/frontend/dist"

if [ ! -d "$FRONTEND_DIST_DIR" ]; then
  echo "Missing frontend/dist. Build the frontend first:"
  echo "  cd frontend && npm run build"
  exit 1
fi

if [ ! -f "$BACKEND_DIR/venv/bin/activate" ]; then
  echo "Missing backend virtual environment. Create it first:"
  echo "  cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

PORT="${QUIZ_APP_PORT:-8000}"

echo "Starting app on http://localhost:$PORT..."
cd "$BACKEND_DIR"
source venv/bin/activate

echo
echo "Quiz app is running:"
echo "  http://localhost:$PORT"
echo
echo "Press Ctrl+C to stop."

uvicorn app.main:app --host 127.0.0.1 --port "$PORT"
