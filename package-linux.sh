#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
APP_NAME="Nemoris"
OUTPUT_DIR="$BACKEND_DIR/dist/$APP_NAME"
DATABASE_FILE="$BACKEND_DIR/questions.db"
STATIC_DIR="$BACKEND_DIR/static"

if [ ! -f "$DATABASE_FILE" ]; then
  echo "Missing backend/questions.db."
  echo "Create or restore the local database before packaging, then rerun this script."
  exit 1
fi

echo "Creating data backup before packaging..."
"$ROOT_DIR/backup-data.sh" --reason packaging --label before-package

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

if ! pip install -r requirements-desktop.txt; then
  echo
  echo "Desktop dependency install failed. PyGObject needs system packages:"
  echo "  sudo apt install libwebkit2gtk-4.1-0 gir1.2-webkit2-4.1 libgirepository1.0-dev libcairo2-dev pkg-config python3-dev gcc"
  echo "Install them, then rerun this script."
  exit 1
fi

pip install pyinstaller

echo "Building Linux executable..."
pyinstaller \
  --name "$APP_NAME" \
  --onedir \
  --noconfirm \
  --add-data "assets:assets" \
  --add-data "../frontend/dist:frontend/dist" \
  run_desktop.py

echo "Copying seed data (imported into ~/.local/share/nemoris on first run)..."
mkdir -p "$OUTPUT_DIR/seed/static"
cp "$DATABASE_FILE" "$OUTPUT_DIR/seed/questions.db"

if [ -d "$STATIC_DIR" ]; then
  cp -R "$STATIC_DIR"/. "$OUTPUT_DIR/seed/static/"
fi

echo
echo "Done. Export this folder:"
echo "  $OUTPUT_DIR"
echo
echo "Run it with:"
echo "  $OUTPUT_DIR/$APP_NAME"
echo
echo "Note: the native window needs libwebkit2gtk-4.1-0 on the target machine;"
echo "without it the app falls back to the default browser."
