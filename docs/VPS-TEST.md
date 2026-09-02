# First real server: a SaaS test drive on a fresh VPS

This is the runbook for standing the app up on a public VPS **in SaaS mode,
empty, as a test** — signup flow, plans, platform panel, the works — without
touching the NAS or any real data. Written against LightNode (Hong Kong),
but any Ubuntu VPS works the same. Moving your REAL data to a server later
is a different exercise: that one is docs/SERVER-MIGRATION.md.

Time budget: about an hour, most of it waiting for the build.

## 0. Provisioning choices (on the provider's order page)

- **Region**: **Tokyo, Seoul, or Singapore** — fast from Yiwu, no ICP filing
  needed, and Anthropic's vision API answers from there. Not Hong Kong:
  it looked obvious and failed the live test twice over — Anthropic
  geo-blocks HK addresses (`403 Request not allowed`), and Moonshot's
  anti-DDoS edge drops the app's large photo uploads from that network
  (both in Troubleshooting below). Whatever region you pick, run this as
  the very first command after your first SSH login — no key needed, and
  if it fails, destroy the instance and pick another region before
  investing a minute more:

  ```sh
  curl -s https://api.anthropic.com/v1/messages \
    -H "content-type: application/json" -d '{}'
  ```

  `authentication_error` is the good answer — the request got past the
  geo gate and died at the missing key. `Request not allowed` means this
  region cannot run AI transcription: pick another.
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
apt install -y docker.io docker-compose-v2 ufw git nano
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

LightNode also has a **cloud firewall** in its panel — set it to the same
three ports (22, 80, 443) and nothing else. Two fences, same shape.

## 2. Get the app

```sh
mkdir -p /opt && cd /opt
git clone https://github.com/Changzer/mbarete-app.git
cd mbarete-app
```

Write `.env` with this block rather than by hand: it generates its own
secrets on the server, so nothing sensitive is ever typed, pasted, or
screenshotted. Change the two email lines and the domain to yours.

```sh
cat > .env <<EOF
AUTH_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 24)

DEPLOY_MODE=saas
SIGNUP_CODE=$(openssl rand -hex 12)
PLATFORM_ADMIN_EMAIL=you@yourdomain.com
APP_ORIGIN=https://test.yourdomain.com

COMPANY_NAME=Mbarete
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=$(openssl rand -hex 12)

BACKUP_DIR=/app/backups
BACKUP_RETENTION=14
BACKUP_INTERVAL_HOURS=24
EOF
grep SIGNUP_CODE .env
```

Save that signup code — it is what you present at /signup, and the only
thing between the internet and company creation. Then append the optional
extras: `SMTP_*` (password resets, invites, and the error-alert emails),
`ALERT_EMAIL`, `MOONSHOT_API_KEY` for AI capture, and `HEARTBEAT_URL` —
which must be a **NEW** healthchecks.io check, never the NAS's: two
servers pinging one check means the check stays green while one of them
is dead.

**Verify the file parsed** before building — a terminal paste can glue a
stray character onto the first variable name, and Compose then silently
ignores it (see Troubleshooting):

```sh
grep -vE '^[A-Za-z_][A-Za-z0-9_]*=|^$' .env    # should print nothing
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
    # The app buffers each upload in memory while it parses it. It refuses a
    # body it cannot measure (411) and one over its own 80 MB cap (413), but
    # the proxy is the right place to drop an oversized body before a byte of
    # it reaches the app.
    request_body {
        max_size 100MB
    }
    reverse_proxy localhost:3000
}
```

`systemctl reload caddy`. With the DNS A record set, the first visit
fetches a certificate automatically.

Postgres (5432) is compose-internal and never reaches the host. Port 3000
is different: the compose default publishes it on **every** interface, which
is right for a LAN NAS and wrong for an internet-facing server. Set in `.env`:

```sh
APP_PORT_BIND=127.0.0.1:3000:3000
```

then `docker compose up -d` and confirm from your laptop that
`curl -m 5 http://<server-ip>:3000` now fails while the https domain still
answers. Blocking inbound 3000 in the provider's firewall panel as well
costs nothing and covers the day someone edits `.env` carelessly.

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

## Troubleshooting the things that actually go wrong

**Login answers "There was a problem with the server configuration."**
Auth.js has no signing key. Nine times out of ten the `.env`'s FIRST line
was mangled by the terminal's bracketed paste — a stray character glues
itself to the variable name (`bAUTH_SECRET=…`), so Compose never sees the
real one. It warns, quietly, in every command: `The "AUTH_SECRET" variable
is not set. Defaulting to a blank string.`

Diagnose (prints no secrets):

```sh
docker compose exec mbarete-app sh -c 'echo "secret length: ${#AUTH_SECRET}"'
grep -vE '^[A-Za-z_][A-Za-z0-9_]*=|^$' .env
```

`secret length: 0` confirms it; the second command prints every line that
is not a clean `KEY=value` — a mangled name shows up there. Fix, which also
rolls the secret (note: no `^` anchor, so it catches the mangled name too):

```sh
sed -i '/AUTH_SECRET=/d' .env
echo "AUTH_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d
docker compose exec mbarete-app sh -c 'echo "secret length: ${#AUTH_SECRET}"'   # want 64
```

The same trick works for any variable: check the length inside the
container, never trust that the file "looks right".

**Commands that don't exist.** The provider's Ubuntu image is minimized:
`nano` and `nslookup` are missing. `apt install -y nano` for the editor,
and use `getent hosts test.example.com` in place of `nslookup`.

**Photo transcription does nothing (Moonshot unreachable for real calls).**
The panel's error line shows `transcribe:product` failures; container logs
say `moonshot 502: <html>…` or `TypeError: fetch failed`. Small requests
work — `curl -s -o /dev/null -w "%{http_code}\n" https://api.moonshot.cn/v1/models`
returns `401` (a healthy answer: the API saw you, you sent no key) — but
the real transcription POST carries megabytes of base64 photo, and that is
what dies. `api.moonshot.cn` sits behind an Alibaba anti-DDoS front
(`dig` shows a `…aliyunddos….com` CNAME) which drops large request bodies
from some networks; this provider's Hong Kong range was one. Proof, from
the host — a ~2 MB POST that should bounce off the API with a normal
HTTP error code:

```sh
KEY=$(grep '^MOONSHOT_API_KEY=' .env | cut -d= -f2-)
{ printf '{"model":"kimi-k2.6","messages":[{"role":"user","content":"'; head -c 1500000 /dev/zero | base64 | tr -d '\n'; printf '"}]}'; } > /tmp/big.json
curl -s -o /dev/null -w "big POST: %{http_code}\n" --max-time 60 \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  --data-binary @/tmp/big.json https://api.moonshot.cn/v1/chat/completions
```

Any three-digit code means the path is fine and the problem is elsewhere;
`000` means the edge ate the body and no server setting will fix it. The
remedy is the app's other vision backend — add to `.env` and restart:

```sh
ANTHROPIC_API_KEY=sk-ant-…
TRANSCRIBE_PROVIDER=anthropic
```

No code changes: `src/lib/vision.ts` speaks both APIs and validates both
into the same shape. On a server whose network does reach Moonshot (a
mainland box, a NAS at home), leave `TRANSCRIBE_PROVIDER` unset — the
Moonshot key wins automatically when present.

The switch has a trap of its own: Anthropic geo-blocks unsupported
regions, Hong Kong included — every request from a blocked address gets
`403 {"type":"forbidden","message":"Request not allowed"}` before the
key is even read, so no `.env` change can fix it. A 403 there means the
server's REGION is wrong, and Hong Kong is the unlucky pick where both
backends fail at once. Hence the region advice in section 0 and its
first-login probe. Live-tested: the large-POST drop reproduces from
Tokyo too, so treat Moonshot as reachable-from-the-mainland-only and
plan on the Anthropic backend for any overseas box.
