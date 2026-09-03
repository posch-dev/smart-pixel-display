#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvDir = Join-Path $RepoDir ".venv"
$VenvPy  = Join-Path $VenvDir "Scripts\python.exe"

function Info  { param($m) Write-Host "[+] $m" -ForegroundColor Green }
function Warn  { param($m) Write-Host "[!] $m" -ForegroundColor Yellow }
function Fail  { param($m) Write-Host "[x] $m" -ForegroundColor Red; exit 1 }

if ($args -contains "--fresh" -and (Test-Path $VenvDir)) {
    Remove-Item -Recurse -Force $VenvDir
    Info "Removed the old venv."
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { Fail "python not found. Install Python 3.11 or newer from python.org." }

$version = & python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
$parts = $version.Split(".")
if ([int]$parts[0] -lt 3 -or ([int]$parts[0] -eq 3 -and [int]$parts[1] -lt 11)) {
    Fail "Python 3.11+ required (found $version)."
}
Info "Python $version"

if (-not (Test-Path (Join-Path $RepoDir "startup.py"))) { Fail "startup.py not found in $RepoDir" }

if (Test-Path $VenvDir) {
    Info "Existing venv found at .venv\"
} else {
    Info "Creating venv ..."
    & python -m venv $VenvDir
}

Info "Installing dependencies ..."
& $VenvPy -m pip install --upgrade pip -q
& $VenvPy -m pip install -r (Join-Path $RepoDir "requirements.txt") -q
Info "Dependencies installed."

Set-Location $RepoDir
& $VenvPy -m assets.system.installer @args
exit $LASTEXITCODE
