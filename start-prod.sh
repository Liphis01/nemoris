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

cleanup() {
  echo
  echo "Stopping production servers..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}

trap cleanup EXIT

echo "Starting backend on http://localhost:8000..."
cd "$BACKEND_DIR"
source venv/bin/activate
uvicorn app.main:app &
BACKEND_PID=$!

echo "Serving frontend build on http://localhost:5173..."
cd "$FRONTEND_DIST_DIR"
python3 -m http.server 5173 &
FRONTEND_PID=$!

echo
echo "Quiz app is running:"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
echo
echo "Press Ctrl+C to stop."

wait
