#!/bin/sh
# Pull the server's newest backup to this NAS, verify it, keep history.
#
# Runs ON THE NAS (a UGREEN, any Linux box), from cron. The NAS reaches out
# to the server, never the other way round: nothing at the office is opened
# to the internet, and the server holds no key to the NAS — whoever breaks
# into the server cannot reach, change or delete the copies here.
#
# Each run:
#   1. asks the server (over SSH, with a key that can only READ the backups
#      folder — docs/NAS-BACKUP.md) for its newest complete backup;
#   2. if this NAS does not have it yet, fetches it with rsync, only the
#      files that changed since the copy before (the rest are hardlinked, so
#      a hundred dailies of the same photos cost one copy); a dropped
#      connection resumes where it stopped, retried with growing waits;
#   3. checks every file against the snapshot's SHA256SUMS — a copy that
#      does not match is thrown away, never kept as if it were good;
#   4. keeps the last KEEP_DAILY snapshots plus the first of each month for
#      KEEP_MONTHLY months, deletes the rest;
#   5. tells the server what it now holds (or why it failed), so the
#      platform panel shows it and the operator is mailed when it goes stale.
#
# Usage:
#   mbarete-nas-backup.sh              one run (what cron calls)
#   mbarete-nas-backup.sh --check      test the connection, list both sides
#   mbarete-nas-backup.sh --plan-retention < names    which names a prune would delete
#
# Settings come from mbarete-nas-backup.conf beside this script (or the file
# in NAS_BACKUP_CONF). See docs/NAS-BACKUP.md for every one of them.

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
CONF="${NAS_BACKUP_CONF:-$HERE/mbarete-nas-backup.conf}"
# shellcheck disable=SC1090
[ -r "$CONF" ] && . "$CONF"

DEST="${DEST:-$HERE}"
VPS="${VPS:-}"
VPS_PORT="${VPS_PORT:-22}"
SSH_KEY="${SSH_KEY:-$DEST/id_ed25519}"
KEEP_DAILY="${KEEP_DAILY:-30}"
KEEP_MONTHLY="${KEEP_MONTHLY:-36}"
RETRIES="${RETRIES:-6}"
# Seconds to wait before each retry, the last one repeating: about 1h45 in all.
RETRY_DELAYS="${RETRY_DELAYS:-60 300 600 1200 1800 1800}"
TIMEOUT="${TIMEOUT:-600}"
BWLIMIT="${BWLIMIT:-}"
REPORT_URL="${REPORT_URL:-}"
REPORT_TOKEN="${REPORT_TOKEN:-}"
SNAPSHOTS="$DEST/snapshots"
INCOMING="$DEST/.incoming"
LOGDIR="$DEST/logs"
LOG="$LOGDIR/nas-backup.log"

# --- retention: pure, testable --------------------------------------------

# stdin: snapshot names (backup-YYYYMMDD-HHMMSS); stdout: the ones to delete.
# Kept: the newest KEEP_DAILY, and the first snapshot of each of the newest
# KEEP_MONTHLY months that have one.
plan_retention() {
  grep -E '^backup-[0-9]{8}-[0-9]{6}$' | sort -u | awk -v daily="$KEEP_DAILY" -v monthly="$KEEP_MONTHLY" '
    { name[NR] = $0 }
    END {
      n = NR; months = 0; prev = ""
      for (i = 1; i <= n; i++) {
        keep[i] = (i > n - daily)
        m = substr(name[i], 8, 6)
        if (m != prev) { first[++months] = i; prev = m }
      }
      for (j = months; j > months - monthly && j >= 1; j--) keep[first[j]] = 1
      keep[n] = 1
      for (i = 1; i <= n; i++) if (!keep[i]) print name[i]
    }'
}

if [ "${1:-}" = "--plan-retention" ]; then
  plan_retention
  exit 0
fi

# --- plumbing ----------------------------------------------------------------

mkdir -p "$SNAPSHOTS" "$INCOMING" "$LOGDIR"

log() {
  line="$(date '+%Y-%m-%d %H:%M:%S')  $*"
  echo "$line"
  echo "$line" >> "$LOG"
}

die_setup() {
  log "SETUP: $*"
  exit 2
}

[ -n "$VPS" ] || die_setup "VPS is not set in $CONF (e.g. VPS=root@203.0.113.10)"
command -v rsync >/dev/null 2>&1 || die_setup "rsync is not installed on this NAS"
command -v sha256sum >/dev/null 2>&1 || die_setup "sha256sum is not installed on this NAS"

# SSH_CMD replaces the whole ssh command line (the test suite fakes the server with it).
if [ -z "${SSH_CMD:-}" ]; then
  [ -r "$SSH_KEY" ] || die_setup "cannot read the SSH key at $SSH_KEY"
  SSH_CMD="ssh -i $SSH_KEY -p $VPS_PORT -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
-o UserKnownHostsFile=$DEST/known_hosts -o ConnectTimeout=30 -o ServerAliveInterval=30 -o ServerAliveCountMax=6"
fi

remote_rsync() {
  # shellcheck disable=SC2086
  rsync -e "$SSH_CMD" --timeout="$TIMEOUT" ${BWLIMIT:+--bwlimit="$BWLIMIT"} "$@"
}

# Runs "$@" until it succeeds or RETRIES attempts are spent.
with_retries() {
  attempt=1
  while :; do
    if "$@"; then return 0; fi
    [ "$attempt" -ge "$RETRIES" ] && return 1
    wait_s="$(echo "$RETRY_DELAYS" | awk -v i="$attempt" '{ print (i <= NF) ? $i : $NF }')"
    log "attempt $attempt failed; trying again in ${wait_s}s"
    sleep "$wait_s"
    attempt=$((attempt + 1))
  done
}

# A message safe inside a JSON string: no quotes, backslashes or line breaks.
json_text() {
  printf '%s' "$1" | tr '\n\r\t' '   ' | tr -d '"\\' | cut -c1-300
}

report() {
  [ -n "$REPORT_URL" ] && [ -n "$REPORT_TOKEN" ] || return 0
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 30 --retry 3 --retry-delay 20 \
      -H "Authorization: Bearer $REPORT_TOKEN" -H "Content-Type: application/json" \
      -d "$1" "$REPORT_URL" >/dev/null 2>&1 || log "could not report to $REPORT_URL"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null --timeout=30 --tries=3 \
      --header="Authorization: Bearer $REPORT_TOKEN" --header="Content-Type: application/json" \
      --post-data="$1" "$REPORT_URL" || log "could not report to $REPORT_URL"
  fi
}

fail() {
  log "FAILED: $*"
  report "{\"ok\":false,\"error\":\"$(json_text "$*")\"}"
  exit 1
}

local_snapshots() {
  ls -1 "$SNAPSHOTS" 2>/dev/null | grep -E '^backup-[0-9]{8}-[0-9]{6}$' | sort
}

report_held() {
  name="$1"
  files="$(grep -c '' "$SNAPSHOTS/$name/SHA256SUMS" 2>/dev/null || echo 0)"
  bytes="$(( $(du -sk "$SNAPSHOTS/$name" | cut -f1) * 1024 ))"
  kept="$(local_snapshots | grep -c '')"
  report "{\"ok\":true,\"snapshot\":\"$name\",\"files\":$files,\"bytes\":$bytes,\"kept\":$kept}"
}

# --- what the server has ------------------------------------------------------

remote_list_raw() {
  remote_rsync --list-only "$VPS:" > "$INCOMING/.list" 2> "$INCOMING/.list-err"
}

# The newest snapshot that is complete (manifest.json) and carries SHA256SUMS.
newest_remote() {
  for name in $(awk '{ print $NF }' "$INCOMING/.list" | grep -E '^backup-[0-9]{8}-[0-9]{6}$' | sort -r); do
    if remote_rsync --list-only "$VPS:$name/manifest.json" >/dev/null 2>&1 &&
      remote_rsync --list-only "$VPS:$name/SHA256SUMS" >/dev/null 2>&1; then
      echo "$name"
      return 0
    fi
  done
  return 1
}

if [ "${1:-}" = "--check" ]; then
  if ! remote_list_raw; then
    echo "Cannot reach the server's backups:"
    cat "$INCOMING/.list-err"
    exit 1
  fi
  prevname="$(local_snapshots | tail -n 1)"
  echo "Connected to $VPS."
  echo "Server backups: $(awk '{ print $NF }' "$INCOMING/.list" | grep -cE '^backup-')"
  echo "Newest the NAS can take: $(newest_remote || echo 'none (no backup with SHA256SUMS yet — press Back up now on the platform panel)')"
  echo "On this NAS: $(local_snapshots | grep -c '') snapshots${prevname:+, newest $prevname}"
  exit 0
fi

# --- one run -------------------------------------------------------------------

# One run at a time. The lock holds the running script's pid: a first copy
# over a slow line can take a day, and a run is only over when its process
# is gone (crash, reboot), never because it has been going for long. A lock
# without a pid (written by an older version of this script) counts as held
# for 48 hours.
LOCK="$DEST/.lock"
lock_alive() {
  holder="$(cat "$LOCK/pid" 2>/dev/null)"
  if [ -n "$holder" ]; then
    kill -0 "$holder" 2>/dev/null || return 1
    # A reused pid after a reboot is someone else's process, not ours.
    [ -r "/proc/$holder/cmdline" ] && ! tr '\0' ' ' < "/proc/$holder/cmdline" | grep -q 'nas-backup' && return 1
    return 0
  fi
  [ -z "$(find "$LOCK" -maxdepth 0 -mmin +2880 2>/dev/null)" ]
}
if ! mkdir "$LOCK" 2>/dev/null; then
  if lock_alive; then
    log "the previous run is still going${holder:+ (pid $holder)}; leaving it alone"
    exit 0
  fi
  log "the previous run is gone without finishing; taking over"
  rm -rf "$LOCK"
  mkdir "$LOCK" 2>/dev/null || { log "another run took the lock first"; exit 0; }
fi
echo $$ > "$LOCK/pid"
# A stopped run ends there (releasing the lock on the way out); it never
# carries on without the lock.
trap 'rm -rf "$LOCK"' EXIT
trap 'exit 1' INT TERM HUP

log "checking $VPS for a new backup"
with_retries remote_list_raw || fail "cannot reach the server: $(tail -n 1 "$INCOMING/.list-err")"
name="$(newest_remote)" || fail "the server has no complete backup with SHA256SUMS yet"

if [ -d "$SNAPSHOTS/$name" ]; then
  log "already have $name — nothing new"
  report_held "$name"
  exit 0
fi

# Leftovers from runs that never finished, for snapshots no longer wanted.
for old in $(ls -1 "$INCOMING" 2>/dev/null | grep -E '^backup-'); do
  [ "$old" = "$name" ] || rm -rf "${INCOMING:?}/$old"
done

prev="$(local_snapshots | tail -n 1)"
log "fetching $name${prev:+ (unchanged files hardlinked to $prev)}"
pull() {
  remote_rsync -rlt --partial --partial-dir=.rsync-partial \
    ${prev:+--link-dest="$SNAPSHOTS/$prev"} \
    "$VPS:$name/" "$INCOMING/$name/" 2>> "$LOG"
}
with_retries pull || fail "could not fetch $name after $RETRIES attempts (see $LOG)"

log "verifying $name"
[ -f "$INCOMING/$name/manifest.json" ] || { rm -rf "${INCOMING:?}/$name"; fail "$name arrived without its manifest"; }
verify() {
  (cd "$INCOMING/$name" && sha256sum -c SHA256SUMS > "$INCOMING/.verify" 2>&1)
}
# rsync trusts size and date to call a file unchanged and hardlinks the old
# copy; if the NAS's old copy rotted, or a file changed without either moving,
# the checksums say so. Fetch again comparing every byte before giving up.
heal() {
  remote_rsync -rlt --checksum --partial --partial-dir=.rsync-partial \
    "$VPS:$name/" "$INCOMING/$name/" 2>> "$LOG"
}
if ! verify; then
  log "some files differ from SHA256SUMS; fetching again, comparing every file by content"
  if ! with_retries heal || ! verify; then
    bad="$(grep -v ': OK$' "$INCOMING/.verify" | head -n 3 | tr '\n' ';')"
    rm -rf "${INCOMING:?}/$name"
    fail "$name failed verification and was discarded: $bad"
  fi
fi
mv "$INCOMING/$name" "$SNAPSHOTS/$name" || fail "could not move $name into $SNAPSHOTS"
log "stored $name ($(grep -c '' "$SNAPSHOTS/$name/SHA256SUMS") files verified)"

for old in $(local_snapshots | plan_retention); do
  rm -rf "${SNAPSHOTS:?}/$old"
  log "pruned $old"
done

report_held "$name"

# The log keeps its last 2000 lines.
tail -n 2000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
exit 0
