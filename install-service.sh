#!/usr/bin/env bash

git config core.fileMode false

set -e

SERVICE_NAME="charlie-update.service"
TIMER_NAME="charlie-update.timer"

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME"
TIMER_FILE="/etc/systemd/system/$TIMER_NAME"

echo "Installing systemd service and timer..."

# Create service file
sudo bash -c "cat > $SERVICE_FILE" <<EOF
[Unit]
Description=Charlie update service
After=network.target

[Service]
Type=oneshot
ExecStart=$REPO_DIR/auto-update.sh
WorkingDirectory=$REPO_DIR
User=$USER
Group=$USER
EOF

# Create timer file
sudo bash -c "cat > $TIMER_FILE" <<EOF
[Unit]
Description=Run Charlie update daily

[Timer]
OnBootSec=5min
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
EOF

echo "Reloading systemd..."
sudo systemctl daemon-reload

echo "Enabling and starting timer..."
sudo systemctl enable "$TIMER_NAME"
sudo systemctl start "$TIMER_NAME"

echo "Done. Timer status:"
systemctl status "$TIMER_NAME" --no-pager
