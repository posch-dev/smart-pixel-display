#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$REPO_DIR/.venv"
SERVICE_NAME="smartpixeldashboard"
TEMPLATE="$REPO_DIR/assets/system/${SERVICE_NAME}.service.template"
TARGET="/etc/systemd/system/${SERVICE_NAME}.service"

info()  { echo -e "\033[0;32m[+]\033[0m $1"; }
warn()  { echo -e "\033[1;33m[!]\033[0m $1"; }
error() { echo -e "\033[0;31m[x]\033[0m $1"; exit 1; }

command -v python3 >/dev/null 2>&1 || error "python3 not found. Install it first (e.g. sudo apt install python3)."

PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PY_MAJOR=${PY_VER%%.*}
PY_MINOR=${PY_VER##*.}
[ "$PY_MAJOR" -ge 3 ] && [ "$PY_MINOR" -ge 11 ] || error "Python 3.11+ required (found $PY_VER)."
info "Python $PY_VER"

python3 -c "import venv" 2>/dev/null || error "python3-venv not found. Install it (e.g. sudo apt install python3-venv)."

command -v bluetoothctl >/dev/null 2>&1 || warn "bluetoothctl not found. You'll need Bluetooth for BLE communication."

[ -f "$REPO_DIR/startup.py" ]  || error "startup.py not found in $REPO_DIR"
[ -f "$TEMPLATE" ]             || error "Service template not found at $TEMPLATE"

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

if [ ! -f "$REPO_DIR/.env" ]; then
    info "No .env file found. Optional, only needed for some panels (see README)."
fi

SERVICE_USER="${SUDO_USER:-$USER}"

if [ "$(id -u)" -eq 0 ] || command -v sudo >/dev/null 2>&1; then
    info "Installing systemd service ($SERVICE_NAME) ..."

    if [ "$(id -u)" -eq 0 ]; then
        sed -e "s|__USER__|$SERVICE_USER|g" \
            -e "s|__WORKDIR__|$REPO_DIR|g" \
            "$TEMPLATE" > "$TARGET"
        systemctl daemon-reload
        systemctl enable "$SERVICE_NAME"
    else
        sed -e "s|__USER__|$SERVICE_USER|g" \
            -e "s|__WORKDIR__|$REPO_DIR|g" \
            "$TEMPLATE" | sudo tee "$TARGET" > /dev/null
        sudo systemctl daemon-reload
        sudo systemctl enable "$SERVICE_NAME"
    fi

    info "Service installed and enabled."
else
    warn "No root/sudo, skipping systemd install."
fi

echo ""
info "Done. To start:"
echo "  source .venv/bin/activate && python startup.py"
echo ""
echo "  Or via systemd:"
echo "  sudo systemctl start $SERVICE_NAME"
echo "  journalctl -u $SERVICE_NAME -f"
