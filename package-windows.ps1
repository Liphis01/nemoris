$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Join-Path $RootDir "frontend"
$BackendDir = Join-Path $RootDir "backend"
$AppName = "QuizApp"
$OutputDir = Join-Path $BackendDir "dist\$AppName"

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [ScriptBlock] $Command,
    [Parameter(Mandatory = $true)]
    [string] $Message
  )

  & $Command

  if ($LASTEXITCODE -ne 0) {
    throw $Message
  }
}

Write-Host "Building frontend..."
Set-Location $FrontendDir

if (-not (Test-Path "node_modules")) {
  Invoke-Checked { npm install --legacy-peer-deps } "npm install failed."
}

Invoke-Checked { npm run build } "Frontend build failed."

Write-Host "Preparing backend environment..."
Set-Location $BackendDir

if (-not (Test-Path "venv\Scripts\Activate.ps1")) {
  Invoke-Checked { py -3.12 -m venv venv } "Could not create venv with Python 3.12. Install Python 3.12 from python.org, then rerun this script."
}

& ".\venv\Scripts\Activate.ps1"
Invoke-Checked { python -m pip install --upgrade pip } "pip upgrade failed."
Invoke-Checked { python -m pip install -r requirements.txt } "Backend dependency install failed."
Invoke-Checked { python -m pip install pyinstaller } "PyInstaller install failed."

Write-Host "Building Windows executable..."
Invoke-Checked {
  python -m PyInstaller `
    --name $AppName `
    --onedir `
    --noconfirm `
    --add-data "..\frontend\dist;frontend\dist" `
    run_desktop.py
} "PyInstaller build failed."

if (-not (Test-Path $OutputDir)) {
  throw "PyInstaller did not create the expected output folder: $OutputDir"
}

Write-Host "Copying writable app data..."
New-Item -ItemType Directory -Force $OutputDir | Out-Null
Copy-Item "questions.db" (Join-Path $OutputDir "questions.db") -Force
New-Item -ItemType Directory -Force (Join-Path $OutputDir "static") | Out-Null

if (Test-Path "static") {
  Copy-Item "static\*" (Join-Path $OutputDir "static") -Recurse -Force
}

Write-Host ""
Write-Host "Done. Export this folder:"
Write-Host "  $OutputDir"
Write-Host ""
Write-Host "Run it with:"
Write-Host "  $(Join-Path $OutputDir "$AppName.exe")"
