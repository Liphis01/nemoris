# Build And Run

The app runs as a Vite/FastAPI dev pair, a production web app, or a native
desktop app built with Tauri.

## Development

From the project root:

```bash
./start.sh
```

The script stops old processes on ports `8000` and `5173`, starts the backend
with `uvicorn app.main:app --reload`, starts Vite, and opens
`http://localhost:5173`. It expects `backend/venv` to exist.

## Production Web Run

Use this when you want FastAPI to serve the built frontend locally:

```bash
cd frontend
npm install --legacy-peer-deps
npm run build

cd ../backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cd ..
./start-prod.sh
```

Open `http://localhost:8000`. To change the port:

```bash
QUIZ_APP_PORT=8765 ./start-prod.sh
```

In production, frontend API calls are relative and FastAPI serves
`frontend/dist`.

## Data Migrations And Backups

The backend runs explicit internal migrations at startup and records them in
`schema_migrations`. Pending migrations that alter existing schema/data create a
zip backup first.

Create an exportable backup manually from the project root:

```bash
./backup-data.sh
```

On Windows:

```powershell
.\backup-data.ps1
```

Backups are written to `backend/backups/` and contain `questions.db`, uploaded
media from `static/`, and `backup-manifest.json`.

To run migrations without starting the app:

```bash
cd backend
source venv/bin/activate
python manage_data.py migrate
```

## Desktop App (Tauri)

The desktop app is a Tauri shell (`frontend/src-tauri`) that owns a frameless
window and runs the FastAPI backend as a **sidecar**: on launch, Rust picks a
free port, starts the packaged backend on it, and injects the URL into the
frontend. The window is created immediately and shows a startup screen until
the backend answers. Window drag, restored-window edge resize, and snap are
native to Tauri. The host keeps the active maximized window non-resizable so
Windows does not expose resize handles at the screen edge, but it re-enables
resizing before minimize/focus-loss transitions so taskbar restore stays
reliable. The styled title bar in
`frontend/src/shared/DesktopTitleBar.jsx` mirrors that state for its custom
controls.

### Release build (CI)

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds the
backend sidecar (PyInstaller onedir), smoke-tests it, then `tauri-action`
bundles the Windows NSIS installer and attaches it to the release. Keep `version` in
`frontend/src-tauri/tauri.conf.json` in sync with the tag.

### Local build / iteration

Prerequisites: Node.js, Python 3.12, the Rust toolchain, and Tauri's system
libraries (on Ubuntu: `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, plus the usual
build tools).

Build the sidecar once, then run Tauri. PyInstaller's complete onedir output is
bundled as the `backend/` resource; do not copy only its executable because it
needs the adjacent `_internal/` directory.

On Linux:

```bash
cd backend
./venv/bin/pyinstaller --name nemoris-backend --onedir --clean --noconfirm \
  --collect-data countryinfo run_sidecar.py

cd ../frontend
npm run tauri dev      # or: npm run tauri build
```

On Windows PowerShell, use `;` as PyInstaller's data separator:

```powershell
cd backend
.\venv\Scripts\pyinstaller.exe --name nemoris-backend --onedir --clean --noconfirm `
  --collect-data countryinfo run_sidecar.py

cd ..\frontend
npm run tauri dev      # or: npm run tauri build
```

`npm run build` runs `frontend/scripts/stop-nemoris-backend.mjs` first, so a
stale packaged sidecar is stopped before Vite/Tauri rebuilds or replaces files.

`npm run tauri build` outputs the installer/bundle under
`frontend/src-tauri/target/release/bundle/`.

## App Data And Tests

- `backend/questions.db` is local dev data and is ignored by git. No database is
  bundled in the release: a fresh install starts on an empty collection, created
  by the migrations on first launch in the user's app-data dir
  (`%APPDATA%\Nemoris` / `~/.local/share/nemoris`), never next to the binary.
  Users get content by subscribing to packs from the catalogue or importing
  their own.
- `backend/static/` contains uploaded media (dev). Installed apps store media
  under the same app-data dir.
- `backend/backups/` contains exportable backup zips and is ignored by git.
- Backend tests live in `backend/tests`. Install `pytest` separately if needed.
