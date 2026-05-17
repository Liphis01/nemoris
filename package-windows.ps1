$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Join-Path $RootDir "frontend"
$BackendDir = Join-Path $RootDir "backend"
$AppName = "QuizApp"
$OutputDir = Join-Path $BackendDir "dist\$AppName"

Write-Host "Building frontend..."
Set-Location $FrontendDir

if (-not (Test-Path "node_modules")) {
  npm install --legacy-peer-deps
}

npm run build

Write-Host "Preparing backend environment..."
Set-Location $BackendDir

if (-not (Test-Path "venv\Scripts\Activate.ps1")) {
  python -m venv venv
}

& ".\venv\Scripts\Activate.ps1"
pip install -r requirements.txt
pip install pyinstaller

Write-Host "Building Windows executable..."
pyinstaller `
  --name $AppName `
  --onedir `
  --noconfirm `
  --add-data "..\frontend\dist;frontend\dist" `
  run_desktop.py

Write-Host "Copying writable app data..."
Copy-Item "questions.db" (Join-Path $OutputDir "questions.db") -Force
New-Item -ItemType Directory -Force (Join-Path $OutputDir "static") | Out-Null
Copy-Item "static\*" (Join-Path $OutputDir "static") -Recurse -Force

Write-Host ""
Write-Host "Done. Export this folder:"
Write-Host "  $OutputDir"
Write-Host ""
Write-Host "Run it with:"
Write-Host "  $(Join-Path $OutputDir "$AppName.exe")"
