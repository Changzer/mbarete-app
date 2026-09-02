# Moving off the NAS: the real-server runbook

> Just want to TRY the app on a public VPS first — empty, in SaaS mode,
> no real data at risk? That's docs/VPS-TEST.md. This document is for the
> day the real install moves.

The whole move is: stand the app up empty on the new machine, carry one
backup over, restore, point the domain, done. The backup/restore machinery
(docs/BACKUPS.md) does the heavy lifting — this document is the order of
operations around it.

Time budget: an afternoon. The NAS keeps running until the very last step,
so nothing is lost if any step goes sideways.

## 0. What to buy / prepare

- **A VPS**: 2 vCPU / 4 GB RAM / 40+ GB SSD is comfortable for years of this
  workload. Pick a region near the users (Hong Kong / Singapore work well for
  a Yiwu + South America split). Ubuntu LTS or Debian.
- **A domain** (or subdomain) with DNS you control.
- The **SMTP** credentials already in use, if any.

## 1. Prepare the server

```sh
# as root on the fresh VPS
adduser mbarete && usermod -aG sudo,docker mbarete   # after installing docker
apt update && apt install -y docker.io docker-compose-v2 ufw
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

Harden SSH (key-only login, no root):
`/etc/ssh/sshd_config` → `PasswordAuthentication no`, `PermitRootLogin no`.

## 2. Install the app (empty)

Clone the repo, copy `.env.example` to `.env`, and fill it in — **fresh
secrets, not the NAS ones**:

- `AUTH_SECRET`: `openssl rand -base64 32`
- `DB_PASSWORD`: new, strong
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`: unchanged is fine (the restore will bring
  the real accounts anyway)
- `DEPLOY_MODE`: keep `self-hosted` until the SaaS launch decision is made;
  flipping to `saas` later is a `.env` change + restart
- `SIGNUP_CODE`: only when going SaaS — long and unguessable
- `APP_ORIGIN`: `https://app.example.com` (email links build from this)
- SMTP vars as on the NAS
- `BACKUP_DIR`: point at a second disk or leave the volume default for now

`docker compose up -d --build`, then confirm `https://…` is still pending but
`curl localhost:3000` answers. Booting once migrates the schema — required
before restore.

## 3. TLS in front (do not skip)

Caddy is the least-work option — automatic certificates, two lines:

```
# /etc/caddy/Caddyfile
app.example.com {
    # Uploads are parsed in memory; let the proxy refuse an oversized body
    # before it reaches the app (the app's own cap is 80 MB, and it refuses
    # a body with no Content-Length at all).
    request_body {
        max_size 100MB
    }
    reverse_proxy localhost:3000
}
```

`apt install caddy`, set the DNS A record to the server IP, and Caddy fetches
the certificate on first request. (nginx + certbot works the same if
preferred.) The app already sends HSTS; behind https the session cookie
becomes `Secure` automatically.

Never publish port 3000 or 5432 to the internet. Postgres already stays
compose-internal, but the compose default DOES publish 3000 on every
interface (the NAS's LAN deployment needs that) — on a public server set
`APP_PORT_BIND=127.0.0.1:3000:3000` in `.env` so only Caddy can reach the
app, and block inbound 3000 in the provider's firewall for good measure.

## 4. Carry the data over

On the NAS, make a fresh snapshot first: admin panel → **Back up now**. Then
copy the newest backup directory across (rsync preserves the hardlinks):

```sh
rsync -aH /volume1/.../backups/backup-YYYYMMDD-HHMMSS/  mbarete@SERVER:/tmp/carry/
```

On the server, restore into the running (still-empty, already-migrated) app:

```sh
docker compose cp /tmp/carry mbarete-app:/tmp/carry
docker compose exec mbarete-app npx tsx scripts/restore-backup.ts /tmp/carry
docker compose restart mbarete-app
```

Sign in at the domain **with the NAS credentials** — accounts, hashes,
products, orders, photos all came from the snapshot. Spot-check: catalog
renders photos, an order opens, the proforma prints, Settings shows the
company profile.

## 5. Cut over

1. Freeze changes on the NAS (tell the team, or stop its container).
2. If anything changed since step 4's snapshot: Back up now on the NAS again,
   rsync, restore again — restores are idempotent and take minutes.
3. Point everyone at the domain. Keep the NAS container stopped but intact
   for a couple of weeks as a belt-and-braces copy.

## 6. Day-2 on the new server

- **Backups offsite, encrypted**: the app self-backs-up on the server too,
  but the server can die whole, and its backups hold every tenant in plain
  files. Run `scripts/offsite-backup.sh` nightly from cron: it encrypts the
  newest complete backup before it leaves the box and ships it to the NAS
  (full circle: the NAS becomes the offsite copy) or to object storage. The
  setup, the cron line and the restore are in docs/BACKUPS.md § Offsite.
- **Updates**: same auto-update flow as the NAS if installed
  (`scripts/install-auto-update.sh`), or `git pull && docker compose up -d
  --build` by hand after merges.
- **Monitoring the cheap way**: an uptime ping (UptimeRobot or similar) on
  the domain; the platform panel's backup line is the backup monitor.
- Read docs/SECURITY.md — the operator checklist there is the contract this
  runbook assumes.

## Going SaaS later

When the pilot decision lands: set `DEPLOY_MODE=saas` + `SIGNUP_CODE`,
restart, and sign up the operator account (grant it the panel via
`PLATFORM_ADMIN_EMAIL`). The self-hosted company data stays untouched; new
companies arrive through /signup and referral links, metered by their plans.
