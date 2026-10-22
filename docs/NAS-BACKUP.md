# NAS backup: a copy of everything at the office

The Tokyo server backs itself up every night (docs/BACKUPS.md), but those
copies live on the same server. If the provider closes the account, the
disk dies or someone breaks in, they go with it. This sets up a second home
for them: a UGREEN NAS at the office that fetches each night's backup,
checks it, and keeps three years of history.

How it works, in one paragraph: every few hours the NAS logs into the
server with a key that can do exactly one thing — **read** the backups
folder — and fetches the newest backup if it does not have it yet. Only
files that changed travel (photos already on the NAS are not sent again).
Every file is checked against the backup's fingerprints (`SHA256SUMS`); a
copy that does not match is thrown away. The NAS keeps the last 30 nights
plus the first copy of each month for 36 months, then tells the server
what it holds. The platform panel shows it, and you get an email if the
copy at home is ever more than two days old or a night fails.

Why the NAS fetches instead of the server sending: nothing at the office is
opened to the internet, and the server holds no key to the NAS — whoever
breaks into the server can neither reach nor delete the copies at home.

## Setting it up: two pasted lines

Before you start: in UGOS, turn on SSH (Control Panel → Terminal), and — if
you like to see it in the file manager — create a shared folder named
`mbarete-backup` (private to your admin account; not shared through
UGREENlink). If you skip the folder, the setup makes one on `/volume1`.

**1. On the Tokyo server**, logged in as root:

```sh
cd /opt/mbarete-app && git pull && sh scripts/nas/setup-server.sh
```

It installs `rsync`, gives the app its report token, restarts the app on
this version (a few minutes), makes a fresh backup — and then prints one
green line and waits. Leave that window open.

**2. On the NAS**, log in over SSH (`ssh your-nas-admin@NAS-IP`) and paste
the green line. It asks for the NAS password once (for `sudo`). It makes the
NAS's own key, introduces it to the server with a one-time code (the server
window then lets it in, read-only, by itself), schedules the backup every 6
hours, and starts the first copy in the background.

Both windows end with "Done" / "All set". The first copy carries every photo
and document, so over the Tokyo line it can take hours; the admin panel shows
`NAS copy: backup-… · Nh old` once it has arrived. Last, press **Test email**
on the panel: that is how the alarm reaches you, so it must arrive.

Either script can be run again safely (with a fresh green line): nothing is
duplicated, your own login keys are never touched, copies already on the NAS
stay.

The parts below are the same setup done by hand, step by step — for when
something does not go as above, or to see exactly what the scripts do.

---

## Part A — the Tokyo server

Log in to the server as root, as you do for deploys.

**A1. Deploy, then make one fresh backup.** The fingerprint file the NAS
checks is written by backups made from this version on. After `git pull &&
docker compose up -d --build`, open the platform panel and press **Back up
now**. The line next to it should read `Backups: N kept · last under an hour ago`.

**A2. Find the backups folder.**

```sh
docker volume inspect -f '{{.Mountpoint}}' mbarete-app_mbarete-backups
```

It prints something like `/var/lib/docker/volumes/mbarete-app_mbarete-backups/_data`.
(If it says "no such volume", run `docker volume ls | grep backups` and use
that name.) Write the path down — it is **BACKUPS** below.

**A3. Install `rsync` (it brings `rrsync`).** `rsync` copies the files;
`rrsync` is the small program that limits the NAS key to reading that one
folder. Many servers have neither until you install them:

```sh
apt-get update && apt-get install -y rsync
command -v rsync rrsync
rrsync 2>&1 | head -2
```

The second command must print two paths (`/usr/bin/rsync`, `/usr/bin/rrsync`)
and the third a short complaint (it was not started by SSH) — that means it
works. If `rrsync` is still missing (older systems package it separately),
fetch the official script; it needs `python3`, which Ubuntu and Debian have:

```sh
curl -fsSL https://raw.githubusercontent.com/RsyncProject/rsync/v3.2.7/support/rrsync -o /usr/local/bin/rrsync
chmod 755 /usr/local/bin/rrsync
head -1 /usr/local/bin/rrsync     # must print a #! line, not nothing
```

**A4. Make the report token** — the password the NAS uses to tell the server
what it holds.

```sh
openssl rand -hex 32
```

Add it to `/opt/mbarete-app/.env` as `NAS_REPORT_TOKEN=<the long string>`
and apply it with `cd /opt/mbarete-app && docker compose up -d`. Keep the
string for step B5. (For the email alarm, the server needs its email
settings — `SMTP_*` in `.env`; the panel's **Test email** button
proves they work.)

Step A5 needs the NAS key from step B3. Do part B up to B3, then come back.

**A5. Let the NAS key in — read-only, backups folder only.** Open
`/root/.ssh/authorized_keys` (`nano /root/.ssh/authorized_keys`) and add
**one line** at the end: the restriction, then the key from step B3.

```
restrict,command="/usr/bin/rrsync -ro BACKUPS" ssh-ed25519 AAAA…the rest of the key… mbarete-nas
```

Replace `BACKUPS` with the path from A2, and `/usr/bin/rrsync` with
whatever `command -v rrsync` printed in A3. `restrict` takes away
everything else a key could do (no shell, no tunnels); `rrsync -ro` allows
reading that folder and nothing more. Save. Nothing needs restarting.

---

## Part B — the UGREEN NAS

**B1. A private folder.** In UGOS, create a shared folder named
`mbarete-backup` on your main storage pool. Give access to your own admin
account only, and do not share it through UGREENlink or a public link: it
holds every customer, price and password hash. If your UGOS offers
encrypted shared folders, use one.

**B2. Turn on SSH and log in.** UGOS → Control Panel → Terminal → enable
SSH. From your computer:

```sh
ssh your-nas-admin@NAS-IP-ADDRESS
sudo -i
ls -d /volume*/mbarete-backup
```

The last line prints the folder's real path, e.g. `/volume1/mbarete-backup`.
That is **FOLDER** below.

**B3. Put the script in place and make the NAS key.** Download
`scripts/nas/mbarete-nas-backup.sh` and
`scripts/nas/mbarete-nas-backup.conf.example` from GitHub to your computer,
and upload both into the `mbarete-backup` folder with the UGOS file
manager. Then, in the SSH window:

```sh
cd FOLDER
chmod 755 mbarete-nas-backup.sh
ssh-keygen -t ed25519 -N "" -C mbarete-nas -f id_ed25519
cat id_ed25519.pub
```

Copy the line `cat` prints (it starts with `ssh-ed25519`) — it goes into
step A5 on the server. Do A5 now.

**B4. Check `rsync` is on the NAS.**

```sh
command -v rsync sha256sum curl
```

All three should print a path. (UGOS ships them; if one is missing, tell
whoever maintains this.)

**B5. Fill in the settings.**

```sh
cp mbarete-nas-backup.conf.example mbarete-nas-backup.conf
nano mbarete-nas-backup.conf
```

Set `VPS=root@<the Tokyo server's IP>` (and `VPS_PORT` if SSH is not on 22),
and `REPORT_TOKEN=` the string from A4. The history settings are already
30 nights and 36 months. Save.

**B6. Test the connection.**

```sh
./mbarete-nas-backup.sh --check
```

It should say `Connected`, how many backups the server has, and the newest
one the NAS can take. If it says `none (no backup with SHA256SUMS yet)`,
press **Back up now** on the panel (A1) and run it again.

**B7. The first copy.** The first one carries every photo and document, so
it takes a while over the Tokyo line; let it run in the background:

```sh
nohup ./mbarete-nas-backup.sh > first-run.log 2>&1 &
tail -f logs/nas-backup.log
```

Wait for `stored backup-… (N files verified)`, then Ctrl-C the `tail`. If
the line drops, the script retries by itself and picks up where it
stopped. Later nights only carry what changed and take minutes.

**B8. Schedule it.** Every six hours — it fetches the nightly backup within
hours of it being made, and a run with nothing new costs a few seconds.

```sh
crontab -e
```

Add this line (with your FOLDER), save:

```
15 */6 * * * FOLDER/mbarete-nas-backup.sh >/dev/null 2>&1
```

If `crontab` is not found on your UGOS version, use a systemd timer instead:

```sh
cat > /etc/systemd/system/mbarete-nas-backup.service <<EOF
[Service]
Type=oneshot
ExecStart=FOLDER/mbarete-nas-backup.sh
EOF
cat > /etc/systemd/system/mbarete-nas-backup.timer <<EOF
[Timer]
OnCalendar=*-*-* 00/6:15:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload && systemctl enable --now mbarete-nas-backup.timer
```

A firmware update may wipe either one. You do not need to remember to check:
if the NAS stops fetching, the server emails you within two days.

**B9. Done — check the panel.** Next to the backup line it now reads
`NAS copy: backup-… · Nh old · 1 kept`. The count grows by one a night up to
30, then by about one a month.

---

## What you get

- **On the NAS:** `FOLDER/snapshots/backup-YYYYMMDD-HHMMSS/`, one folder per
  kept night, each a complete backup (database dump, every uploaded file,
  `manifest.json`, `SHA256SUMS`). Unchanged files are shared between
  folders, so 30 nights plus 36 months take roughly one copy of all files
  plus each night's new ones.
- **Log:** `FOLDER/logs/nas-backup.log` — every run, every retry, every prune.
- **On the panel:** the NAS line turns amber with `STALE` when the newest
  copy at home is more than 48 hours old (`NAS_STALE_HOURS` changes it), or
  shows the last failure.
- **Email:** at most one a day while something is wrong.

## When the email arrives

- **"the NAS backup failed: cannot reach the server"** — the NAS could not
  connect after six tries (about two hours). Usually the internet at the
  office or the server itself. It tries again in six hours; run
  `./mbarete-nas-backup.sh --check` on the NAS to see now.
- **"no fresh backup on the NAS"** — look at the panel's `Backups:` line
  first. If the server's own backups are stale, the server stopped backing
  up (press **Back up now**, read the error it shows). If they are fresh,
  the NAS stopped fetching: is it on? Is the schedule still there
  (`crontab -l`, or `systemctl list-timers | grep mbarete`)? What does the
  end of `logs/nas-backup.log` say?
- **"failed verification and was discarded"** — a fetched copy did not
  match its fingerprints even after a second, byte-by-byte fetch. The older
  copies on the NAS are untouched. If it happens two nights running, the
  server's backup itself is damaged: press **Back up now** and have it
  looked at.

## Restoring from the NAS

If the server is gone, you restore onto a new one:

1. Install the app on the new server (INSTALL.md) at the **same version**
   the backup was made with, and let it boot once.
2. Copy the newest folder from the NAS to the new server — from the NAS:
   `rsync -a FOLDER/snapshots/backup-YYYYMMDD-HHMMSS root@NEW-SERVER:/root/`
3. On the new server:

   ```sh
   cd /opt/mbarete-app
   docker compose cp /root/backup-YYYYMMDD-HHMMSS mbarete-app:/app/backups/
   docker compose exec mbarete-app npx tsx scripts/restore-backup.ts /app/backups/backup-YYYYMMDD-HHMMSS
   docker compose restart mbarete-app
   ```

   The restore checks every file against the backup's fingerprints before
   it touches anything (docs/BACKUPS.md, "Restoring").

4. Log in with your old password.

**Once a quarter**, check a copy at home on its own, on the NAS:

```sh
cd FOLDER/snapshots/$(ls FOLDER/snapshots | tail -n 1) && sha256sum -c --quiet SHA256SUMS && echo ALL GOOD
```

And once a year, do the full restore on a spare machine. A backup nobody
has ever restored is a hope, not a backup.
