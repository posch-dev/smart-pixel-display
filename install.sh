#!/usr/bin/env bash
set -e
WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_USER="$(whoami)"
SERVICE_NAME="smartpixelpanel"
TEMPLATE="$WORKDIR/assets/system/${SERVICE_NAME}.service.template"
TARGET="/etc/systemd/system/${SERVICE_NAME}.service"
REQUIREMENTS="$WORKDIR/requirements.txt"

if [ ! -f "$TEMPLATE" ]; then
    echo "Error: template not found at $TEMPLATE"
    exit 1
fi
if [ ! -f "$WORKDIR/startup.py" ]; then
    echo "Error: startup.py not found in $WORKDIR"
    exit 1
fi
if [ ! -f "$REQUIREMENTS" ]; then
    echo "Error: requirements.txt not found at $REQUIREMENTS"
    exit 1
fi

echo "Installing Python dependencies..."
if ! pip3 install -r "$REQUIREMENTS" --break-system-packages 2>/dev/null; then
    echo "Falling back to standard pip install..."
    pip3 install -r "$REQUIREMENTS"
fi

echo "Installing ${SERVICE_NAME}.service for user '$SERVICE_USER' in $WORKDIR ..."
sed -e "s|__USER__|$SERVICE_USER|g" \
    -e "s|__WORKDIR__|$WORKDIR|g" \
    "$TEMPLATE" | sudo tee "$TARGET" > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"
echo ""
echo "Status:"
sudo systemctl status "$SERVICE_NAME" --no-pager