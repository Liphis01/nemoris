#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
APP_NAME="QuizApp"
OUTPUT_DIR="$BACKEND_DIR/dist/$APP_NAME"
DATABASE_FILE="$BACKEND_DIR/questions.db"
STATIC_DIR="$BACKEND_DIR/static"

if [ ! -f "$DATABASE_FILE" ]; then
  echo "Missing backend/questions.db."
  echo "Create or restore the local database before packaging, then rerun this script."
  exit 1
fi

echo "Building frontend..."
cd "$FRONTEND_DIR"

if [ ! -d "node_modules" ]; then
  npm install --legacy-peer-deps
fi

npm run build

echo "Preparing backend environment..."
cd "$BACKEND_DIR"

if [ ! -f "venv/bin/activate" ]; then
  python3 -m venv venv
fi

source venv/bin/activate
pip install -r requirements.txt
pip install pyinstaller

echo "Building Linux executable..."
pyinstaller \
  --name "$APP_NAME" \
  --onedir \
  --noconfirm \
  --add-data "../frontend/dist:frontend/dist" \
  run_desktop.py

echo "Copying writable app data..."
cp "$DATABASE_FILE" "$OUTPUT_DIR/questions.db"
mkdir -p "$OUTPUT_DIR/static"

if [ -d "$STATIC_DIR" ]; then
  cp -R "$STATIC_DIR"/. "$OUTPUT_DIR/static/"
fi

echo
echo "Done. Export this folder:"
echo "  $OUTPUT_DIR"
echo
echo "Run it with:"
echo "  $OUTPUT_DIR/$APP_NAME"
