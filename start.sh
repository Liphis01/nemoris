#!/bin/bash

cd "$(dirname "$0")"

echo "Stopping old processes..."

# tuer seulement les processus sur les ports
fuser -k 8000/tcp 2>/dev/null
fuser -k 5173/tcp 2>/dev/null

echo "Starting backend..."
cd backend
PYTHONPATH= venv/bin/python -m uvicorn app.main:app --reload &

echo "Starting frontend..."
cd ../frontend
npm run dev &

sleep 2
URL="http://localhost:5173"
if command -v explorer.exe >/dev/null 2>&1; then
    explorer.exe "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"
else
    echo "Open $URL in your browser."
fi
