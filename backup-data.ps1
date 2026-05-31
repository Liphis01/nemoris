$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RootDir "backend"
$VenvPython = Join-Path $BackendDir "venv\Scripts\python.exe"

Set-Location $BackendDir

if (Test-Path $VenvPython) {
  & $VenvPython "manage_data.py" "backup" @args
} else {
  & py -3.12 "manage_data.py" "backup" @args
}

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
