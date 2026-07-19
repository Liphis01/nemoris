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
free port, starts the packaged backend on it, waits for it to answer, and
injects the URL into the frontend. Window drag, all-edge resize, and snap are
native to Tauri — no custom title-bar code beyond the styled bar in
`frontend/src/shared/DesktopTitleBar.jsx`.

### Release build (CI)

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds the
backend sidecar (PyInstaller onefile), then `tauri-action` bundles the Windows
NSIS installer and attaches it to the release. Keep `version` in
`frontend/src-tauri/tauri.conf.json` in sync with the tag.

### Local build / iteration

Prerequisites: Node.js, Python 3.12, the Rust toolchain, and Tauri's system
libraries (on Ubuntu: `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, plus the usual
build tools).

Build the sidecar once, place it where Tauri expects it, then run:

```bash
# 1. Build the backend as a single-file sidecar
cd backend
./venv/bin/pyinstaller --name nemoris-backend --onefile --noconfirm \
  --add-data "questions.db:seed" run_sidecar.py

# 2. Place it under the target triple Tauri resolves at runtime
TRIPLE=$(rustc -vV | sed -n 's/host: //p')
mkdir -p ../frontend/src-tauri/binaries
cp dist/nemoris-backend "../frontend/src-tauri/binaries/nemoris-backend-$TRIPLE"

# 3. Dev (HMR window) or a full bundle
cd ../frontend
npm run tauri dev      # or: npm run tauri build
```

`npm run tauri build` outputs the installer/bundle under
`frontend/src-tauri/target/release/bundle/`.

## App Data And Tests

- `backend/questions.db` is local dev data and is ignored by git. The desktop
  release seeds a fresh copy from `backend/questions.csv` and bundles it in the
  sidecar; on first launch it is copied into the user's app-data dir
  (`%APPDATA%\Nemoris` / `~/.local/share/nemoris`), never next to the binary.
- `backend/static/` contains uploaded media (dev). Installed apps store media
  under the same app-data dir.
- `backend/backups/` contains exportable backup zips and is ignored by git.
- Backend tests live in `backend/tests`. Install `pytest` separately if needed.
