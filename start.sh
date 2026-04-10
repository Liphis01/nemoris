#!/bin/bash

echo "Stopping old processes..."

# tuer seulement les processus sur les ports
fuser -k 8000/tcp 2>/dev/null
fuser -k 5173/tcp 2>/dev/null

echo "Starting backend..."
cd backend
source venv/bin/activate
uvicorn app.main:app &

echo "Starting frontend..."
cd ../frontend
npm run dev &

sleep 2
explorer.exe http://localhost:5173