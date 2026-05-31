# Build And Run

The app runs as a Vite/FastAPI dev pair, a production web app, or a portable
PyInstaller folder.

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

## Linux Portable Build

From the project root:

```bash
./package-linux.sh
```

The script builds Vite, prepares `backend/venv`, installs PyInstaller, bundles
`backend/run_desktop.py`, creates a data backup, and copies writable app data.

Output:

```bash
backend/dist/QuizApp/
```

Run:

```bash
backend/dist/QuizApp/QuizApp
```

## Windows Portable Build

Build on Windows because PyInstaller output is OS-specific.

Prerequisites:

- Node.js/npm
- Python 3.12 from python.org
- PowerShell permission to run local scripts

From PowerShell:

```powershell
.\package-windows.ps1
```

If PowerShell blocks the script:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Output:

```text
backend\dist\QuizApp\
```

Run:

```powershell
backend\dist\QuizApp\QuizApp.exe
```

## App Data And Tests

- `backend/questions.db` is local data and is ignored by git. Portable builds
  require it.
- `backend/static/` contains uploaded media and is copied into portable builds
  when present.
- `backend/backups/` contains exportable backup zips and is ignored by git.
- Export the whole `QuizApp` output folder, not only the executable.
- Backend tests live in `backend/tests`. Install `pytest` separately if needed.
