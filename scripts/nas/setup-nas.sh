#!/bin/sh
# The NAS half of the backup setup, in one pasted line. scripts/nas/setup-server.sh
# prints that line on the server; it looks like:
#
#   curl -fsSL https://mbarete.cn/api/nas/setup-nas.sh | sudo sh -s -- https://mbarete.cn 203.0.113.10 22 <code>
#
# It does every NAS step of docs/NAS-BACKUP.md:
#   1. finds (or makes) the mbarete-backup folder and puts the backup script in it;
#   2. makes the NAS's own key — the private half never leaves the NAS;
#   3. hands the public half to the server with the one-time code, and gets
#      back the report token;
#   4. waits until the server has let the key in and the connection works;
#   5. schedules the backup every 6 hours and starts the first copy.
#
# Safe to run again with a new code: the key and the copies already made stay.
# For tests: DEST=<folder> SSH_CMD=<ssh replacement> NAS_NO_SCHEDULE=1 NAS_NO_FIRST_RUN=1.

set -u

say() { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mSTOPPED: %s\033[0m\n' "$*" >&2; exit 1; }

[ $# -eq 4 ] || die "use the exact line the server printed (it ends with a long code)"
ORIGIN="${1%/}"
HOST="$2"
PORT="$3"
CODE="$4"
if [ -z "${DEST:-}" ] && [ "$(id -u)" != "0" ]; then die "run it with sudo, as the line the server printed does"; fi

# --- 1. the folder and the script ----------------------------------------------
step "1/5  the backup folder"
for tool in rsync ssh ssh-keygen sha256sum curl; do
  command -v "$tool" >/dev/null 2>&1 && continue
  if [ "$tool" = "rsync" ] && command -v apt-get >/dev/null 2>&1; then
    apt-get install -y -qq rsync >/dev/null 2>&1
  fi
  command -v "$tool" >/dev/null 2>&1 || die "this NAS has no $tool"
done
if [ -z "${DEST:-}" ]; then
  DEST="$(ls -d /volume*/mbarete-backup 2>/dev/null | head -n 1)"
  if [ -z "$DEST" ]; then
    VOL="$(ls -d /volume* 2>/dev/null | head -n 1)"
    [ -n "$VOL" ] || die "no /volume1 on this NAS — create a shared folder named mbarete-backup in UGOS, then paste the line again"
    DEST="$VOL/mbarete-backup"
  fi
fi
mkdir -p "$DEST"
chmod 700 "$DEST"
cd "$DEST" || die "cannot open $DEST"
curl -fsSL "$ORIGIN/api/nas/mbarete-nas-backup.sh" -o mbarete-nas-backup.sh.tmp \
  && head -1 mbarete-nas-backup.sh.tmp | grep -q '^#!' \
  && mv mbarete-nas-backup.sh.tmp mbarete-nas-backup.sh \
  || die "could not download the backup script from $ORIGIN"
chmod 755 mbarete-nas-backup.sh
say "Folder: $DEST"

# --- 2. the NAS's key --------------------------------------------------------------
step "2/5  this NAS's key"
if [ ! -f id_ed25519 ]; then
  ssh-keygen -q -t ed25519 -N "" -C mbarete-nas -f id_ed25519 || die "could not make a key"
  say "New key made"
else
  say "Using the key made before"
fi
chmod 600 id_ed25519

# --- 3. hand the key to the server ---------------------------------------------
step "3/5  introducing this NAS to the server"
PUB="$(awk '{print $1" "$2" mbarete-nas"}' id_ed25519.pub)"
ANSWER="$(curl -sS --max-time 30 -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\",\"publicKey\":\"$PUB\"}" "$ORIGIN/api/backups/nas-pair" 2>&1)"
case "$ANSWER" in
  *'"ok":true'*) ;;
  *) die "the server did not accept this NAS: $ANSWER" ;;
esac
TOKEN="$(printf '%s' "$ANSWER" | sed -n 's/.*"reportToken":"\([^"]*\)".*/\1/p')"
say "Accepted"

{
  echo "# Written by setup-nas.sh — see docs/NAS-BACKUP.md."
  echo "VPS=root@$HOST"
  echo "VPS_PORT=$PORT"
  echo "KEEP_DAILY=30"
  echo "KEEP_MONTHLY=36"
  echo "RETRIES=6"
  echo "REPORT_URL=$ORIGIN/api/backups/nas-report"
  echo "REPORT_TOKEN=$TOKEN"
  [ -n "${SSH_CMD:-}" ] && echo "SSH_CMD=\"$SSH_CMD\""
} > mbarete-nas-backup.conf
chmod 600 mbarete-nas-backup.conf

# --- 4. wait for the server to let the key in -----------------------------------
step "4/5  waiting for the server to let this NAS in"
i=0
until ./mbarete-nas-backup.sh --check > .setup-check.log 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 36 ] && die "the server has not let this NAS in after 3 minutes: $(tail -n 2 .setup-check.log | tr '\n' ' ')"
  sleep 5
done
cat .setup-check.log
rm -f .setup-check.log

# --- 5. schedule and start ---------------------------------------------------------
step "5/5  every 6 hours, starting now"
if [ "${NAS_NO_SCHEDULE:-}" != "1" ]; then
  JOB="15 */6 * * * $DEST/mbarete-nas-backup.sh >/dev/null 2>&1"
  if command -v crontab >/dev/null 2>&1; then
    { crontab -l 2>/dev/null | grep -v 'mbarete-nas-backup.sh'; echo "$JOB"; } | crontab - \
      && say "Scheduled (cron): every 6 hours at :15"
  else
    cat > /etc/systemd/system/mbarete-nas-backup.service <<EOF
[Service]
Type=oneshot
ExecStart=$DEST/mbarete-nas-backup.sh
EOF
    cat > /etc/systemd/system/mbarete-nas-backup.timer <<EOF
[Timer]
OnCalendar=*-*-* 00/6:15:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload && systemctl enable --now mbarete-nas-backup.timer >/dev/null 2>&1 \
      && say "Scheduled (systemd timer): every 6 hours at :15"
  fi
fi
if [ "${NAS_NO_FIRST_RUN:-}" != "1" ]; then
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup ./mbarete-nas-backup.sh > first-run.log 2>&1 < /dev/null &
  else
    nohup ./mbarete-nas-backup.sh > first-run.log 2>&1 < /dev/null &
  fi
  say ""
  say "The first copy is running in the background. It carries every photo and"
  say "document, so over the Tokyo line it can take hours — you can close this"
  say "window. When it is done, the admin panel shows \"NAS copy: …\"."
  say "To watch it:  tail -f $DEST/logs/nas-backup.log"
fi
say ""
say "All set."
