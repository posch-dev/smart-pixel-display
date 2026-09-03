#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$REPO_DIR/.venv"

info()  { echo -e "\033[0;32m[+]\033[0m $1"; }
warn()  { echo -e "\033[1;33m[!]\033[0m $1"; }
error() { echo -e "\033[0;31m[x]\033[0m $1"; exit 1; }

for arg in "$@"; do
    [ "$arg" = "--fresh" ] && rm -rf "$VENV_DIR" && info "Removed the old venv."
done

command -v python3 >/dev/null 2>&1 || error "python3 not found. Install it first (e.g. sudo apt install python3)."

PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PY_MAJOR=${PY_VER%%.*}
PY_MINOR=${PY_VER##*.}
[ "$PY_MAJOR" -ge 3 ] && [ "$PY_MINOR" -ge 11 ] || error "Python 3.11+ required (found $PY_VER)."
info "Python $PY_VER"

python3 -c "import venv" 2>/dev/null || error "python3-venv not found. Install it (e.g. sudo apt install python3-venv)."

command -v bluetoothctl >/dev/null 2>&1 || warn "bluetoothctl not found. You'll need Bluetooth for BLE communication."

[ -f "$REPO_DIR/startup.py" ] || error "startup.py not found in $REPO_DIR"

if [ -d "$VENV_DIR" ]; then
    info "Existing venv found at .venv/"
else
    info "Creating venv ..."
    python3 -m venv "$VENV_DIR"
fi

info "Installing dependencies ..."
"$VENV_DIR/bin/pip" install --upgrade pip -q
"$VENV_DIR/bin/pip" install -r "$REPO_DIR/requirements.txt" -q
info "Dependencies installed."

cd "$REPO_DIR"
exec "$VENV_DIR/bin/python" -m assets.system.installer "$@"
