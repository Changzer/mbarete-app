#!/bin/sh
# Encrypt the newest complete backup and copy it off this machine.
#
# The app's own daily backups (docs/BACKUPS.md) are plain files on the same
# disk as the database they protect, and they hold every tenant and every
# password hash. Retention covers a mistake; it does not cover the server
# burning down or being copied by someone who should not have it. This
# script closes both gaps: one self-contained archive of the newest backup,
# encrypted BEFORE it leaves the box, shipped somewhere else.
#
# Runs on the HOST (not in the container), from cron, after the app's own
# backup hour. Safe to run by hand at any time; a backup already shipped is
# skipped, so reruns cost nothing.
#
#   ./scripts/offsite-backup.sh
#
# Configuration — export before calling, or set on the cron line:
#   OFFSITE_KEY     path to the passphrase file, mode 600. REQUIRED. Make it
#                   once with: (umask 077; openssl rand -base64 48 > /root/.mbarete-offsite.key)
#                   and keep a copy somewhere that is not this server — an
#                   archive nobody can decrypt is not a backup.
#   OFFSITE_DEST    where archives go. REQUIRED. Either an rsync target
#                   (user@nas:/volume1/backups/mbarete/) or an rclone remote
#                   (remote:bucket/mbarete/), chosen by OFFSITE_METHOD.
#   OFFSITE_METHOD  rsync (default) or rclone.
#   BACKUP_SRC      directory holding the app's backup-*/ folders. Default:
#                   the compose volume's mountpoint (docker volume inspect).
#   STAGING_DIR     where archives are built. Default: /var/tmp/mbarete-offsite
#   KEEP_LOCAL      encrypted archives to keep in STAGING_DIR. Default: 3
#
# Restore, on any machine with openssl:
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:KEYFILE \
#     -in backup-YYYYMMDD-HHMMSS.tar.gz.enc | tar -xzf - -C /some/dir
#   then follow docs/BACKUPS.md "Restoring" with that directory.

set -eu

OFFSITE_METHOD="${OFFSITE_METHOD:-rsync}"
STAGING_DIR="${STAGING_DIR:-/var/tmp/mbarete-offsite}"
KEEP_LOCAL="${KEEP_LOCAL:-3}"
LOG="${STAGING_DIR}/offsite.log"

die() {
  echo "offsite-backup: $*" >&2
  exit 1
}

log() {
  mkdir -p "$STAGING_DIR"
  echo "$(date '+%Y-%m-%d %H:%M:%S')  $*" >> "$LOG"
  echo "$*"
}

[ -n "${OFFSITE_KEY:-}" ] || die "OFFSITE_KEY is not set (path to the passphrase file)"
[ -r "$OFFSITE_KEY" ] || die "cannot read OFFSITE_KEY at $OFFSITE_KEY"
[ -n "${OFFSITE_DEST:-}" ] || die "OFFSITE_DEST is not set (rsync target or rclone remote)"
command -v openssl >/dev/null 2>&1 || die "openssl is not installed"
case "$OFFSITE_METHOD" in
  rsync) command -v rsync >/dev/null 2>&1 || die "rsync is not installed" ;;
  rclone) command -v rclone >/dev/null 2>&1 || die "rclone is not installed" ;;
  *) die "OFFSITE_METHOD must be rsync or rclone" ;;
esac

# Where the app writes its backups. Compose keeps them in a named volume;
# its host path is whatever Docker says it is.
if [ -z "${BACKUP_SRC:-}" ]; then
  for vol in mbarete-app_mbarete-backups mbarete_mbarete-backups; do
    if BACKUP_SRC="$(docker volume inspect -f '{{.Mountpoint}}' "$vol" 2>/dev/null)"; then
      break
    fi
    BACKUP_SRC=""
  done
fi
[ -n "$BACKUP_SRC" ] && [ -d "$BACKUP_SRC" ] || die "no backup directory found; set BACKUP_SRC"

# The newest COMPLETE backup: the manifest is written last, so its presence
# is the mark of one that finished.
newest=""
for dir in $(ls -1d "$BACKUP_SRC"/backup-* 2>/dev/null | sort -r); do
  if [ -f "$dir/manifest.json" ]; then
    newest="$dir"
    break
  fi
done
[ -n "$newest" ] || die "no complete backup under $BACKUP_SRC (nothing has a manifest.json yet)"

name="$(basename "$newest")"
archive="$STAGING_DIR/$name.tar.gz.enc"
marker="$STAGING_DIR/.shipped-$name"
mkdir -p "$STAGING_DIR"
chmod 700 "$STAGING_DIR"

if [ -f "$marker" ]; then
  log "already shipped $name — nothing to do"
  exit 0
fi

# tar of ONE backup directory: files hardlinked into older backups are
# stored as plain files here, so the archive stands on its own. Encrypted
# in the same pipe — nothing plaintext ever lands in STAGING_DIR.
log "packing $name"
tar -C "$BACKUP_SRC" -cf - "$name" \
  | gzip -1 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$OFFSITE_KEY" -out "$archive.tmp"
mv "$archive.tmp" "$archive"
( cd "$STAGING_DIR" && sha256sum "$name.tar.gz.enc" > "$name.tar.gz.enc.sha256" )
size="$(du -h "$archive" | cut -f1)"

log "shipping $name ($size) via $OFFSITE_METHOD to $OFFSITE_DEST"
case "$OFFSITE_METHOD" in
  rsync)
    rsync -a --partial "$archive" "$archive.sha256" "$OFFSITE_DEST"
    ;;
  rclone)
    rclone copy "$archive" "$OFFSITE_DEST"
    rclone copy "$archive.sha256" "$OFFSITE_DEST"
    # Read it back: the copy must exist remotely with the size we sent.
    rclone check --one-way --size-only "$STAGING_DIR" "$OFFSITE_DEST" --include "$name.tar.gz.enc" >/dev/null
    ;;
esac
touch "$marker"
log "shipped $name"

# Keep a few encrypted archives locally, drop the rest — and their markers
# go with the app's own retention: a marker for a backup that no longer
# exists is harmless.
ls -1t "$STAGING_DIR"/*.tar.gz.enc 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))" | while read -r old; do
  rm -f "$old" "$old.sha256"
  log "pruned local $(basename "$old")"
done
