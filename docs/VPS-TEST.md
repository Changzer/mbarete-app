# First real server: a SaaS test drive on a fresh VPS

This is the runbook for standing the app up on a public VPS **in SaaS mode,
empty, as a test** — signup flow, plans, platform panel, the works — without
touching the NAS or any real data. Written against LightNode (Hong Kong),
but any Ubuntu VPS works the same. Moving your REAL data to a server later
is a different exercise: that one is docs/SERVER-MIGRATION.md.

Time budget: about an hour, most of it waiting for the build.

## 0. Provisioning choices (on the provider's order page)

- **Region**: Hong Kong — fast from Yiwu, no ICP filing needed, and both
  Moonshot and Anthropic APIs are reachable.
- **Image**: plain **Ubuntu 24.04 LTS** (22.04 if not offered). Not a
  pre-baked "application image" — the app brings everything it needs.
- **Size**: 2 vCPU / **4 GB RAM** / 50 GB SSD. The 4 GB matters: the Docker
  build is the heaviest thing the server will ever do and can OOM on 2 GB.
- **Login: SSH Key, never Password.** A password-login root box on a public
  IP is brute-forced from minute one. Make a key on your computer first:

  Windows (PowerShell):
  ```
  ssh-keygen -t ed25519 -C "abel-mbarete"
  Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub | clip
  ```
  Mac:
  ```
  ssh-keygen -t ed25519 -C "abel-mbarete"
  pbcopy < ~/.ssh/id_ed25519.pub
  ```
  Press Enter through the prompts, then paste the copied line (it starts
  with `ssh-ed25519 AAAA…`) into the provider's **Add SSH Key** box. The
  file WITHOUT `.pub` is the private half — it never leaves your computer.

- **A domain**: you need one for HTTPS. A subdomain of anything you own is
  fine (`test.yourdomain.com` → an A record pointing at the server IP).
  No domain handy today? `<server-ip>.sslip.io` (literally, e.g.
  `203.0.113.10.sslip.io`) resolves to the server with zero setup and Caddy
  can fetch a real certificate for it — good enough for a test drive.

## 1. First login and base setup

```sh
ssh root@SERVER_IP
apt update && apt upgrade -y
apt install -y docker.io docker-compose-v2 ufw git
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

LightNode also has a **cloud firewall** in its panel — set it to the same
three ports (22, 80, 443) and nothing else. Two fences, same shape.

## 2. Get the app

```sh
mkdir -p /opt && cd /opt
git clone https://github.com/Changzer/mbarete-app.git
cd mbarete-app
cp .env.example .env
nano .env
```

Fill in — everything fresh, nothing copied from the NAS:

```
AUTH_SECRET=            # openssl rand -base64 32 — run it right there in the shell
DB_PASSWORD=            # new and strong; you never type it again
DEPLOY_MODE=saas
SIGNUP_CODE=            # long and unguessable — this gates who can create companies
PLATFORM_ADMIN_EMAIL=   # the email YOU will sign up with — grants the panel
APP_ORIGIN=             # https://test.yourdomain.com (email links build from this)
ADMIN_EMAIL=            # ignored in saas mode, but set them anyway
ADMIN_PASSWORD=         #   (harmless, and required if you ever flip modes)
HEARTBEAT_URL=          # a NEW healthchecks.io check — do not reuse the NAS's
SMTP_*                  # optional for a test; without it, invites/resets are hidden
```

In `saas` mode nothing is seeded at boot: no companies exist until someone
presents the SIGNUP_CODE at /signup. A scanner finding the server before
you sign up finds a login page that accepts nobody.

## 3. Build and start

```sh
docker compose up -d --build
```

15–20 minutes the first time. Then prove it's alive from inside:

```sh
curl -s localhost:3000/api/health    # {"ok":true}
docker compose logs --tail 20 | grep -E "monitor|seed"
```

You should see `SaaS mode — companies come from signup` and the heartbeat
lines. Your healthchecks.io check should go green about now.

## 4. HTTPS in front (do not skip, do not use the app over bare IP)

```sh
apt install -y caddy
```

`/etc/caddy/Caddyfile` — the entire configuration:

```
test.yourdomain.com {
    reverse_proxy localhost:3000
}
```

`systemctl reload caddy`. With the DNS A record set, the first visit
fetches a certificate automatically. Ports 3000 and 5432 stay unpublished
to the internet — the compose file already keeps it that way.

## 5. Become the first tenant, then the operator

1. Open `https://test.yourdomain.com/signup`, present the SIGNUP_CODE, and
   create your test company — this mints its owner account (use the same
   email you put in PLATFORM_ADMIN_EMAIL).
2. Restart once so the boot grant picks the account up:
   `docker compose restart mbarete-app`.
3. Sign in → the platform panel path (`/16015975/mbarete-admin`) now works
   for you and 404s for everyone else. Confirm the unlock prompt asks for
   your password before any plan/seat change.

## 6. The test-drive checklist

Work the product like a stranger would:

- Catalog: create products (hit the free plan's 50 cap on purpose — the
  51st must be refused; edits at 50 must still work).
- Seats: free = 1 user; an invite past the cap must be refused. Bump extra
  seats from the panel (after unlocking) and watch it admit exactly one.
- Orders: build → confirm → proforma prints → edit keeps prices → shipped
  freezes everything.
- Backups: panel → **Back up now**; the backups line goes green.
- Monitoring, the fun one: `docker compose stop`, wait ~10 minutes for the
  healthchecks email, `docker compose up -d`, get the recovery email. Now
  you trust it.
- Errors: `docker compose stop mbarete-db`, load a page signed-in, start
  the DB again — the panel's error line shows the incident.

## 7. When the test is done

- **Keep it** as the future pilot server: it's already correct — just treat
  SIGNUP_CODE as the invitation you hand pilot companies, and add the
  nightly offsite `rsync -aH` of BACKUP_DIR (docs/BACKUPS.md).
- **Or wipe it**: destroy the VPS in the provider panel. Nothing real ever
  lived on it — that was the point.

Either way, the NAS never noticed any of this happened.
