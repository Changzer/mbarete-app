#!/bin/sh
# Update Mbarete from a source ZIP, for hosts that cannot reach GitHub.
#
# Download the repository ZIP on a machine that can reach GitHub, copy it to
# the NAS, then run this. Your .env is preserved and the previous version is
# kept so an update can be undone.
#
#   ./scripts/update-from-zip.sh /volume1/docker/mbarete-app-main.zip
#
# Products, orders and uploaded photos live in Docker volumes and are never
# touched by this script.

set -eu

ZIP="${1:-}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PARENT_DIR="$(dirname "$APP_DIR")"
APP_NAME="$(basename "$APP_DIR")"
STAMP="$(date +%Y%m%d-%H%M%S)"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -n "$ZIP" ] || die "usage: $0 /path/to/mbarete-app-main.zip"
[ -f "$ZIP" ] || die "no such file: $ZIP"
command -v unzip >/dev/null 2>&1 || die "unzip is not installed on this host"
[ -f "$APP_DIR/.env" ] || die "no .env found in $APP_DIR — refusing to continue, you would lose your login and secret"

echo "==> Extracting $ZIP"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -q "$ZIP" -d "$WORK"

# GitHub ZIPs contain a single top-level directory, e.g. mbarete-app-main/
SRC="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[ -n "$SRC" ] || die "the archive did not contain a directory"

# Refuse anything that is not recognisably this application.
for required in package.json docker-compose.yml Dockerfile drizzle; do
  [ -e "$SRC/$required" ] || die "extracted folder is missing $required — is this the right ZIP?"
done

echo "==> Carrying over your settings"
cp "$APP_DIR/.env" "$SRC/.env"

echo "==> Backing up the current version to ${APP_NAME}-backup-${STAMP}"
mv "$APP_DIR" "$PARENT_DIR/${APP_NAME}-backup-${STAMP}"
mv "$SRC" "$APP_DIR"

echo "==> Rebuilding"
cd "$APP_DIR"
if docker compose version >/dev/null 2>&1; then
  docker compose up -d --build
else
  docker-compose up -d --build
fi

echo
echo "Done. Previous version kept at $PARENT_DIR/${APP_NAME}-backup-${STAMP}"
echo "Check it started cleanly with:  docker compose logs --tail 20"
echo "To roll back:"
echo "  cd $PARENT_DIR && rm -rf $APP_NAME && mv ${APP_NAME}-backup-${STAMP} $APP_NAME && cd $APP_NAME && docker compose up -d --build"
