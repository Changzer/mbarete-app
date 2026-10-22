#!/bin/sh
# One command on the Tokyo server to get the NAS backup going.
#
#   cd /opt/mbarete-app && git pull && sh scripts/nas/setup-server.sh
#
# It does every server step of docs/NAS-BACKUP.md:
#   1. installs rsync (which brings rrsync) and proves rrsync runs;
#   2. gives the app a report token and restarts it with this version;
#   3. takes a fresh backup (with SHA256SUMS) for the NAS's first copy;
#   4. prints ONE command to paste on the NAS, then waits — the NAS hands its
#      key over by itself (a one-time code, open for 20 minutes);
#   5. lets that key in read-only, backups folder only, and says when it's done.
#
# Safe to run again: nothing is duplicated, a NAS key from an earlier run is
# replaced, your own login keys are never touched.
#
# For tests and unusual servers, each guess can be given instead:
#   BACKUPS=<dir>  AUTH_KEYS=<file>  APP_ORIGIN=<https://…>  NAS_HOST=<ip>
#   NAS_PORT=<port>  SKIP_DEPLOY=1  PAIR_MINUTES=20

set -u

say() { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mSTOPPED: %s\033[0m\n' "$*" >&2; exit 1; }

[ -f docker-compose.yml ] || die "run this from the app folder: cd /opt/mbarete-app && sh scripts/nas/setup-server.sh"
if [ -z "${AUTH_KEYS:-}" ] && [ "$(id -u)" != "0" ]; then die "run it as root"; fi
AUTH_KEYS="${AUTH_KEYS:-/root/.ssh/authorized_keys}"

# --- 1. rsync and rrsync -------------------------------------------------------
step "1/5  rsync"
if ! command -v rsync >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    say "Installing rsync…"
    apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq rsync >/dev/null 2>&1
  elif command -v dnf >/dev/null 2>&1; then dnf install -y -q rsync >/dev/null 2>&1
  elif command -v yum >/dev/null 2>&1; then yum install -y -q rsync >/dev/null 2>&1
  fi
fi
command -v rsync >/dev/null 2>&1 || die "could not install rsync"

# An empty rrsync (left by an earlier attempt) is worse than none.
for f in /usr/local/bin/rrsync; do
  if [ -f "$f" ] && ! head -1 "$f" | grep -q '^#!'; then rm -f "$f"; fi
done
RRSYNC="$(command -v rrsync 2>/dev/null || true)"
if [ -z "$RRSYNC" ]; then
  say "This rsync package has no rrsync; fetching the official one…"
  curl -fsSL https://raw.githubusercontent.com/RsyncProject/rsync/v3.2.7/support/rrsync -o /usr/local/bin/rrsync.tmp \
    && head -1 /usr/local/bin/rrsync.tmp | grep -q '^#!' \
    && mv /usr/local/bin/rrsync.tmp /usr/local/bin/rrsync && chmod 755 /usr/local/bin/rrsync
  rm -f /usr/local/bin/rrsync.tmp
  RRSYNC="$(command -v rrsync 2>/dev/null || true)"
fi
[ -n "$RRSYNC" ] || die "rrsync is missing and could not be fetched"
"$RRSYNC" -ro /tmp 2>&1 | grep -qi "sshd\|SSH_ORIGINAL_COMMAND" || die "$RRSYNC does not run (try: $RRSYNC -ro /tmp)"
say "rsync $(rsync --version | head -1 | awk '{print $3}') and $RRSYNC — ok"

# --- 2. report token + this version running ------------------------------------
step "2/5  the app"
touch .env
TOKEN="$(sed -n 's/^NAS_REPORT_TOKEN=//p' .env | tail -n 1 | tr -d '"'"'"' ')"
if [ -z "$TOKEN" ]; then
  TOKEN="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  printf '\n# The NAS reports its nightly copy with this (docs/NAS-BACKUP.md).\nNAS_REPORT_TOKEN=%s\n' "$TOKEN" >> .env
  say "Report token created in .env"
else
  say "Report token already in .env"
fi
if [ "${SKIP_DEPLOY:-}" != "1" ]; then
  say "Rebuilding and restarting the app (a few minutes)…"
  docker compose up -d --build >/dev/null 2>&1 || die "docker compose up -d --build failed — run it by hand to see why"
  i=0
  until curl -fsS -o /dev/null http://127.0.0.1:3000/api/health 2>/dev/null; do
    i=$((i + 1)); [ "$i" -gt 90 ] && die "the app did not come back within 3 minutes (docker compose logs mbarete-app)"
    sleep 2
  done
  say "App is up"
fi

# --- 3. a fresh backup ---------------------------------------------------------
step "3/5  a fresh backup for the NAS"
if [ "${SKIP_DEPLOY:-}" != "1" ]; then
  docker compose exec -T mbarete-app npx tsx scripts/backup-now.ts || die "the backup failed (the panel's Back up now shows why)"
fi

if [ -z "${BACKUPS:-}" ]; then
  for vol in mbarete-app_mbarete-backups mbarete_mbarete-backups; do
    BACKUPS="$(docker volume inspect -f '{{.Mountpoint}}' "$vol" 2>/dev/null || true)"
    [ -n "$BACKUPS" ] && break
  done
fi
[ -n "${BACKUPS:-}" ] && [ -d "$BACKUPS" ] || die "cannot find the backups folder (set BACKUPS=…)"
say "Backups folder: $BACKUPS"

# --- 4. pair with the NAS ------------------------------------------------------
step "4/5  connect the NAS"
ORIGIN="${APP_ORIGIN:-$(sed -n 's/^APP_ORIGIN=//p' .env | tail -n 1 | tr -d '"'"'"' ')}"
ORIGIN="${ORIGIN%/}"
if [ -z "$ORIGIN" ]; then
  printf 'The address you open the app at (e.g. https://mbarete.cn): '
  read -r ORIGIN
  ORIGIN="${ORIGIN%/}"
fi
HOST="${NAS_HOST:-$(curl -fsS4 --max-time 10 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')}"
PORT="${NAS_PORT:-$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')}"
PORT="${PORT:-22}"
if sshd -T 2>/dev/null | grep -qi '^permitrootlogin no'; then
  die "this server refuses root logins over SSH (PermitRootLogin no) — ask for a backup user to be set up instead"
fi

CODE="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
MINUTES="${PAIR_MINUTES:-20}"
EXPIRES="$(date -u -d "+$MINUTES minutes" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v+"$MINUTES"M '+%Y-%m-%dT%H:%M:%SZ')"
rm -f "$BACKUPS/.nas-pair-key"
printf '{"code":"%s","expiresAt":"%s"}\n' "$CODE" "$EXPIRES" > "$BACKUPS/.nas-pair.json"
chmod 644 "$BACKUPS/.nas-pair.json"
trap 'rm -f "$BACKUPS/.nas-pair.json" "$BACKUPS/.nas-pair-key"' EXIT INT TERM

say ""
say "On the NAS: log in over SSH and paste this ONE line (it asks for the NAS password):"
say ""
printf '\033[1;32m%s\033[0m\n' "curl -fsSL $ORIGIN/api/nas/setup-nas.sh | sudo sh -s -- $ORIGIN $HOST $PORT $CODE"
say ""
say "Waiting for the NAS (up to $MINUTES minutes; leave this window open)…"

waited=0
until [ -s "$BACKUPS/.nas-pair-key" ]; do
  sleep 3
  waited=$((waited + 3))
  [ "$waited" -ge $((MINUTES * 60)) ] && die "no word from the NAS in $MINUTES minutes — run this script again"
done
KEY="$(head -n 1 "$BACKUPS/.nas-pair-key")"
printf '%s' "$KEY" | grep -Eq '^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43}( [A-Za-z0-9@._-]{1,64})?$' \
  || die "the NAS sent something that is not a key; nothing was changed"

# --- 5. let the key in, read-only ----------------------------------------------
step "5/5  letting the NAS in (read-only, backups only)"
mkdir -p "$(dirname "$AUTH_KEYS")"
chmod 700 "$(dirname "$AUTH_KEYS")"
touch "$AUTH_KEYS"
# A NAS key from an earlier run goes; every other line stays exactly as it was.
grep -v -e ' mbarete-nas-backup$' -e 'rrsync -ro .* mbarete-nas$' "$AUTH_KEYS" > "$AUTH_KEYS.tmp" || true
KEY_ONLY="$(printf '%s' "$KEY" | awk '{print $1" "$2}')"
printf 'restrict,command="%s -ro %s" %s mbarete-nas-backup\n' "$RRSYNC" "$BACKUPS" "$KEY_ONLY" >> "$AUTH_KEYS.tmp"
chmod 600 "$AUTH_KEYS.tmp"
mv "$AUTH_KEYS.tmp" "$AUTH_KEYS"
say "Done on the server. The NAS finishes by itself — look at its window."
