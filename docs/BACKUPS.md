# Backups and restore

The app snapshots **everything** — every company's database rows and every
uploaded file — into `BACKUP_DIR` once a day, automatically, from inside the
app itself. No cron, no extra container. If `BACKUP_DIR` is unset the feature
is off (the platform panel says so).

## What a backup is

One directory per snapshot:

```
/app/backups/
  backup-20260825-050000/        ← UTC timestamp; newest name sorts last
    manifest.json                ← written LAST — its presence marks a complete backup
    db/
      companies.jsonl.gz         ← one gzipped JSON-lines file per table, all rows
      products.jsonl.gz
      …every public table…
    uploads/                     ← mirror of the uploads volume (minus the .variants resize cache)
```

Details worth knowing:

- **Uploads are hardlinked, not re-copied.** A file unchanged since the
  previous backup is a hardlink to it, so fourteen dailies of years of photos
  cost roughly one copy plus each day's new files. Deleting old backups only
  frees space no newer backup still references.
- **Backups contain password hashes and every tenant's data.** Unlike the
  in-app "Export data" zip (which is tenant-scoped and strips hashes), this
  is the operator's disaster copy — treat `BACKUP_DIR` with the same care as
  the database itself.
- The dump is JSON-lines rather than `pg_dump` because the app image ships no
  postgres client tools; the restore script below is the matching loader.
- A crash mid-backup leaves only a `.tmp-*` directory, cleaned up on the next
  run. Anything named `backup-*` with a `manifest.json` is complete.
- **The database dump is one consistent snapshot** (a single `REPEATABLE
  READ` transaction): an order saved mid-backup lands wholly in the next
  backup, never half in this one. The **uploads mirror is best-effort** by
  contrast — files are copied while the app may still be writing, so a photo
  uploaded during the backup window can be in the dump's rows but missing
  from that snapshot's files (it is in the next one). Restores tolerate
  this: a missing file shows as a broken image, nothing worse.
- **The dump refuses to run blind.** It must connect as a role that bypasses
  row-level security (`DATABASE_ADMIN_URL`); connected as the RLS-bound app
  role it would silently dump empty tables, so it errors instead and the
  panel shows the error.
- **Everything is hashed.** The manifest records a SHA-256 for every table
  dump and every uploaded file (hardlinked files inherit last night's hash —
  same bytes, no re-read). Restore verifies all of it BEFORE touching live
  data, so a bit-rotted or truncated backup is refused, never half-loaded.
  Table dumps stream through a server-side cursor, so memory stays flat as
  history grows.
- **A migration never runs against unprotected data.** When an update ships
  new migrations, boot takes a fresh backup FIRST and refuses to migrate if
  that backup fails — the snapshot is the undo button the auto-updater
  otherwise lacks. Fresh installs and installs without `BACKUP_DIR` are
  unaffected.
- **Restoring uploads is a swap, not an overwrite.** The backup's files are
  staged beside the live directory and swapped in whole; files deleted
  before the backup was taken cannot linger as leftovers, and the previous
  state stays at `<uploads>.pre-restore` until you spot-check and delete it.
- **The drill runs in CI.** Every pull request backs up a populated
  database, damages rows and files, proves a corrupted backup is refused
  untouched, and restores the intact one exactly.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `BACKUP_DIR` | `/app/backups` in Docker; unset elsewhere | Where snapshots go. Unset = off. |
| `BACKUP_RETENTION` | `14` | How many snapshots to keep. |
| `BACKUP_INTERVAL_HOURS` | `24` | How often one is due. |

The schedule state is the newest backup on disk, checked hourly — so a NAS
that reboots nightly still gets its daily backup. The platform panel
(`/16015975/mbarete-admin`) shows count and age, turns amber past 26 hours,
and has a **Back up now** button — use it before anything risky (an update,
a migration to new hardware).

**Strongly recommended:** point `BACKUP_DIR` at a bind mount on a *different
physical disk* than the Postgres/uploads volumes, or at a mounted NAS share.
A backup on the disk that died protects nothing. In `.env`:

```
BACKUP_DIR=/mnt/backup-disk/mbarete
```

and change the `mbarete-backups` volume line in `docker-compose.yml` to that
bind mount (`- /mnt/backup-disk/mbarete:/mnt/backup-disk/mbarete`).

## Restoring

Restore is **destructive**: it truncates every table and replaces rows and
uploads with the snapshot's. Do it on a quiet instance.

### Same server (undo a disaster)

```sh
# 1. pick a snapshot
docker compose exec mbarete-app ls /app/backups

# 2. restore into the running container (app keeps serving; do this at a quiet hour)
docker compose exec mbarete-app npx tsx scripts/restore-backup.ts /app/backups/backup-20260825-050000

# 3. restart so every in-memory cache resets
docker compose restart mbarete-app
```

### New server (migration or total loss)

1. Install the app on the new machine as usual (`INSTALL.md`), let it boot
   once — that runs migrations and creates an empty, current schema.
2. Copy one snapshot directory from the old `BACKUP_DIR` to the new machine
   (e.g. into the `mbarete-backups` volume or any path the container can see).
3. Run the restore command above pointing at it.
4. Restart. Log in with the OLD credentials — accounts, password hashes and
   all data came from the snapshot.

### Safety rails built into the script

- The manifest records the schema's migration count at backup time; the
  script **aborts on a mismatch** (boot the app once so migrations run, then
  retry; `--force` overrides for the rare deliberate case).
- Row counts are verified against the manifest table-by-table; the whole
  load is one transaction — a failed restore leaves the database as it was.
- Sequences are realigned after loading, so new records continue from the
  restored ids.
- `--skip-uploads` restores only the database.

## Offsite, encrypted

Retention protects against mistakes and disk loss (if `BACKUP_DIR` is on
another disk), not against the whole machine burning down or being seized.
The snapshots are plain, readable files — every tenant's contacts, prices
and invoices — so a copy that leaves the server must leave encrypted.

`scripts/offsite-backup.sh` does exactly that, from the host (not the
container), for the newest complete snapshot:

1. Finds the newest snapshot directory with a `manifest.json` in the backup
   volume (auto-detected from Docker, or `BACKUP_SRC`).
2. Streams it through `tar | gzip | openssl enc -aes-256-cbc -pbkdf2` with
   the passphrase in the key file — one `.tar.gz.enc` per snapshot, plus a
   `.sha256`.
3. Ships both with `rsync` over SSH (default) or `rclone` (`OFFSITE_METHOD=rclone`
   for S3, Backblaze, OneDrive…).
4. Remembers what was shipped so a rerun is a no-op, and keeps the last
   `KEEP_LOCAL` encrypted copies in `STAGING_DIR` (default 3).

Set it up once:

```sh
# The key. Anyone with this file and a copy can read every tenant's data;
# nobody without it can. Keep a second copy of it OFF this machine — a
# password manager entry is fine — or the offsite copies are worthless.
(umask 077; openssl rand -base64 48 > /root/.mbarete-offsite.key)

# Try it by hand first.
OFFSITE_KEY=/root/.mbarete-offsite.key \
OFFSITE_DEST=user@nas:/volume1/backups/mbarete/ \
/opt/mbarete-app/scripts/offsite-backup.sh

# Then daily, an hour after the app's own snapshot (BACKUP_HOUR_UTC).
crontab -e
30 6 * * * OFFSITE_KEY=/root/.mbarete-offsite.key OFFSITE_DEST=user@nas:/volume1/backups/mbarete/ /opt/mbarete-app/scripts/offsite-backup.sh >> /var/log/mbarete-offsite.log 2>&1
```

Restoring from an offsite copy: bring the `.enc` file back, verify, decrypt
into a directory, then restore that directory like any local snapshot.

```sh
sha256sum -c 2026-09-01T06-00-00Z.tar.gz.enc.sha256
mkdir restore && cd restore
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:/root/.mbarete-offsite.key \
  -in ../2026-09-01T06-00-00Z.tar.gz.enc | tar -xzf -
# → ./2026-09-01T06-00-00Z/ with manifest.json, tables/, uploads/
```

Test the restore once a quarter on a machine that is not the server. A
backup nobody has ever restored is a hope, not a backup.

## What this does NOT cover

- **Offsite copies you did not set up.** The app takes snapshots; shipping
  them off the machine is the host's cron job above, and it only exists once
  someone creates the key and the destination.
- **Point-in-time recovery.** Snapshots are daily; work since the last one
  is lost on restore. For a busy SaaS on a real server, add continuous WAL
  archiving at the Postgres level later.
- **Rolling back an update.** The auto-updater moves the schema forward;
  restoring a backup taken *before* an update into the *updated* schema is
  exactly the migration-count mismatch the script aborts on. To truly roll
  back, check out the older code first so its migrations match the snapshot,
  then restore. When in doubt, press **Back up now** before merging anything
  risky — a fresh snapshot on the current schema always restores cleanly.
