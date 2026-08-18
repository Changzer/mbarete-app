#!/bin/sh
# Install the auto-updater so the NAS follows main on its own.
#
#   sudo ./scripts/install-auto-update.sh          # check every 5 minutes
#   sudo ./scripts/install-auto-update.sh 15       # check every 15 minutes
#
# Uses a systemd timer where systemd is available, and falls back to cron.
# Run it again at any time to change the interval; it replaces what it
# installed before rather than stacking up duplicates.
#
# To remove it:  sudo ./scripts/install-auto-update.sh --uninstall

set -eu

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$APP_DIR/scripts/auto-update.sh"
INTERVAL="${1:-5}"
UNIT=mbarete-auto-update
CRON_MARK="# mbarete-auto-update"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -f "$SCRIPT" ] || die "cannot find $SCRIPT"
chmod +x "$SCRIPT"

uninstall() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl disable --now "$UNIT.timer" 2>/dev/null || true
    rm -f "/etc/systemd/system/$UNIT.timer" "/etc/systemd/system/$UNIT.service"
    systemctl daemon-reload 2>/dev/null || true
  fi
  if command -v crontab >/dev/null 2>&1; then
    crontab -l 2>/dev/null | grep -v "$CRON_MARK" | crontab - 2>/dev/null || true
  fi
  echo "Auto-update removed. The app keeps running; it just will not update itself."
}

if [ "$INTERVAL" = "--uninstall" ]; then
  uninstall
  exit 0
fi

case "$INTERVAL" in
  ''|*[!0-9]*) die "interval must be a whole number of minutes, e.g. 5" ;;
esac
[ "$INTERVAL" -ge 1 ] || die "interval must be at least 1 minute"

if command -v systemctl >/dev/null 2>&1 && [ -d /etc/systemd/system ]; then
  echo "==> Installing systemd timer (every ${INTERVAL} min)"

  cat > "/etc/systemd/system/$UNIT.service" <<EOF
[Unit]
Description=Update Mbarete from git and rebuild if it changed
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=$APP_DIR
ExecStart=$SCRIPT
EOF

  cat > "/etc/systemd/system/$UNIT.timer" <<EOF
[Unit]
Description=Check for Mbarete updates every ${INTERVAL} minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=${INTERVAL}min
Unit=$UNIT.service

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable --now "$UNIT.timer"

  echo
  echo "Done. The NAS now follows main on its own."
  echo
  echo "  See what it has done:   tail -f $APP_DIR/auto-update.log"
  echo "  Check the timer:        systemctl status $UNIT.timer"
  echo "  Force a check now:      sudo systemctl start $UNIT.service"
  echo "  Turn it off:            sudo $0 --uninstall"
  exit 0
fi

command -v crontab >/dev/null 2>&1 || die "neither systemd nor cron is available on this host"

echo "==> systemd not available, installing a cron job (every ${INTERVAL} min)"
( crontab -l 2>/dev/null | grep -v "$CRON_MARK" || true
  echo "*/$INTERVAL * * * * $SCRIPT >/dev/null 2>&1 $CRON_MARK"
) | crontab -

echo
echo "Done. The NAS now follows main on its own."
echo
echo "  See what it has done:   tail -f $APP_DIR/auto-update.log"
echo "  Check the job:          crontab -l"
echo "  Force a check now:      $SCRIPT"
echo "  Turn it off:            sudo $0 --uninstall"
