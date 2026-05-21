# Build Guide

This project can be run as a production web app or exported as a portable
desktop folder.

The frontend is built with Vite. In production, API calls are relative, so the
FastAPI backend serves both the API and the generated `frontend/dist` files.

## Ubuntu Portable Build

Use the Linux packaging script from the project root:

```bash
./package-linux.sh
```

The script:

1. builds the Vite frontend in `frontend/dist`
2. prepares `backend/venv`
3. installs backend requirements and PyInstaller
4. bundles `backend/run_desktop.py`
5. copies writable app data into the output folder

The output folder is:

```bash
backend/dist/QuizApp/
```

Run the packaged app with:

```bash
backend/dist/QuizApp/QuizApp
```

When exporting the app, copy the whole `backend/dist/QuizApp` folder. The
`_internal` folder, `questions.db`, and `static` folder are part of the app.

## Production Web Run

Use this when you want the built app locally without a PyInstaller package:

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

Then open:

```text
http://localhost:8000
```

Set a different port with:

```bash
QUIZ_APP_PORT=8765 ./start-prod.sh
```

## Windows Portable Build

Build the Windows executable on Windows. PyInstaller output is OS-specific, so
an Ubuntu or WSL build does not create a Windows `.exe`.

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

The output folder is:

```text
backend\dist\QuizApp\
```

Run the packaged app with:

```powershell
backend\dist\QuizApp\QuizApp.exe
```

Export the whole `QuizApp` folder, not only the `.exe`.

## Gotchas

- `backend/questions.db` is local app data and is ignored by git. The portable
  packaging scripts require it so the exported app has a database to use.
- `backend/static/` contains uploaded media and is ignored by git. If it exists,
  packaging copies it into the exported app.
- Build Linux packages on the oldest Ubuntu version you want to support when
  compatibility matters.
- In WSL or headless Linux, the automatic browser open can fail while the app
  server still starts normally.
- Backend tests require `pytest`, but `pytest` is not currently part of
  `backend/requirements.txt`.
