#!/bin/sh
# Deploy the latest main to this NAS, if it has changed.
#
# One run: fetch, compare, and rebuild only when the branch actually moved.
# Meant to be called on a timer by scripts/install-auto-update.sh, but it is
# safe to run by hand at any time.
#
#   ./scripts/auto-update.sh
#
# Your .env is untracked and never touched. Products, orders and uploaded
# photos live in Docker volumes and are never touched.
#
# Configuration, all optional (export before calling, or edit the timer):
#   BRANCH          branch to follow            (default: main)
#   HEALTH_URL      checked after a rebuild     (default: http://127.0.0.1:3000/en/login)
#   HEALTH_TRIES    attempts, 5s apart          (default: 24, i.e. two minutes)
#   COMPOSE_CMD     override the compose binary (default: auto-detected)
#   FETCH_TRIES     network retries             (default: 3)

set -eu

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH="${BRANCH:-main}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/en/login}"
HEALTH_TRIES="${HEALTH_TRIES:-24}"
FETCH_TRIES="${FETCH_TRIES:-3}"

LOG="$APP_DIR/auto-update.log"
LOCK_DIR="$APP_DIR/.auto-update.lock"
SKIP_FILE="$APP_DIR/.auto-update-skip"
SKIP_NOTICE="$APP_DIR/.auto-update-skip-notice"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S')  $*" >> "$LOG"
}

# Keep the log from growing without bound on a device nobody logs into.
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 1000000 ]; then
  tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

# mkdir is atomic, so two overlapping timer runs cannot both deploy.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "another run is already in progress, skipping"
  exit 0
fi
cleanup() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

cd "$APP_DIR"

if [ ! -d .git ]; then
  log "ERROR: $APP_DIR is not a git clone, so there is nothing to follow."
  log "       Auto-update needs a clone: git clone <repo> and copy your .env into it."
  exit 1
fi

if [ -n "${COMPOSE_CMD:-}" ]; then
  compose() { $COMPOSE_CMD "$@"; }
elif docker compose version >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { docker-compose "$@"; }
else
  log "ERROR: neither 'docker compose' nor 'docker-compose' is available"
  exit 1
fi

# --- is there anything new? -------------------------------------------------

fetched=""
i=1
delay=2
while [ "$i" -le "$FETCH_TRIES" ]; do
  if git fetch --quiet origin "$BRANCH" 2>>"$LOG"; then
    fetched=yes
    break
  fi
  log "fetch attempt $i failed, retrying in ${delay}s"
  sleep "$delay"
  i=$((i + 1))
  delay=$((delay * 2))
done

if [ -z "$fetched" ]; then
  log "could not reach the repository after $FETCH_TRIES attempts, will try again next run"
  exit 0
fi

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

[ "$LOCAL" = "$REMOTE" ] && exit 0

# A commit that already failed its health check is not retried in a loop.
if [ -f "$SKIP_FILE" ] && grep -q "^$REMOTE$" "$SKIP_FILE"; then
  if [ ! -f "$SKIP_NOTICE" ] || [ "$(cat "$SKIP_NOTICE")" != "$REMOTE" ]; then
    log "$REMOTE previously failed to start and is being skipped; push a fix to $BRANCH"
    echo "$REMOTE" > "$SKIP_NOTICE"
  fi
  exit 0
fi

log "--------------------------------------------------------------"
log "update found on $BRANCH: $(git log --oneline -1 "$REMOTE" 2>/dev/null || echo "$REMOTE")"

# --- deploy -----------------------------------------------------------------

# Anything edited on the NAS itself is stashed rather than thrown away.
if [ -n "$(git status --porcelain)" ]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  log "local changes found; stashing them as auto-update-$STAMP"
  git stash push -u -m "auto-update-$STAMP" >>"$LOG" 2>&1 || true
fi

git reset --hard "$REMOTE" >>"$LOG" 2>&1

log "rebuilding"
if ! compose up -d --build >>"$LOG" 2>&1; then
  # A failed build leaves the previous container running, so the app is still
  # up. Return to the old commit so the next run compares against it cleanly.
  log "BUILD FAILED — the previous version is still running"
  echo "$REMOTE" >> "$SKIP_FILE"
  git reset --hard "$LOCAL" >>"$LOG" 2>&1
  exit 1
fi

# --- did it actually come up? -----------------------------------------------

healthy=""
i=1
while [ "$i" -le "$HEALTH_TRIES" ]; do
  code="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    healthy=yes
    break
  fi
  sleep 5
  i=$((i + 1))
done

if [ -n "$healthy" ]; then
  log "deployed $(git rev-parse --short HEAD) and the app is answering"
  exit 0
fi

# Built fine but will not serve. Go back to the version that worked, so the
# NAS is not left down until somebody notices.
log "HEALTH CHECK FAILED at $HEALTH_URL — rolling back to $(git rev-parse --short "$LOCAL")"
echo "$REMOTE" >> "$SKIP_FILE"
git reset --hard "$LOCAL" >>"$LOG" 2>&1

if compose up -d --build >>"$LOG" 2>&1; then
  log "rolled back; the previous version is running again"
else
  log "ROLLBACK FAILED — the app may be down, ssh in and run: docker compose up -d --build"
fi
exit 1
