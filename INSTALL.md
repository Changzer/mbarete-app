# Installing Mbarete on your Ugreen NAS — step by step

This guide assumes you have **never used a terminal before**. Every command is written out for you to copy and paste. After each one, there's a note about what you should see, so you always know whether it worked.

Take it one step at a time. Nothing here can break your NAS or your files.

**Time needed:** about 30 minutes the first time (most of it is waiting for the app to build).

---

## What you'll need

- Your Ugreen NAS, turned on and connected to your network
- The admin username and password you use to log into the NAS web interface
- A computer on the **same network** as the NAS (same Wi-Fi / same router)
- A GitHub account that can see the `mbarete-app` repository (yours: `Changzer`)

---

## Step 0: Get the code onto the `main` branch first

**Read this before anything else, or Step 6 will download an empty folder.**

The app was delivered as a pull request that hasn't been merged yet. The code physically lives on a branch called `claude/trading-internal-tool-bzi4h6`, not on `main`.

You have two options. **Option A is recommended.**

### Option A — Merge the pull request (recommended)

1. On your computer, open: https://github.com/Changzer/mbarete-app/pull/1
2. The PR is marked as a **draft**. Click the **"Ready for review"** button.
3. Click the green **"Merge pull request"** button, then **"Confirm merge"**.

That's it. The code is now on `main`, and the rest of this guide works as written.

### Option B — Install from the branch without merging

If you'd rather not merge yet, you can install directly from the branch. Everything in this guide stays the same **except** the download command in Step 6 — I've noted the alternative there.

---

## Step 1: Turn on SSH on the NAS

SSH is what lets you type commands on the NAS from your computer. It's off by default.

1. Open your NAS in a web browser and log in as admin (the usual UGOS web interface).
2. Go to **Control Panel** (or **Settings**) → look for **Terminal**, **SSH**, or **Terminal & SNMP**.
   - The exact name varies slightly between UGOS versions. You're looking for a page with an "SSH" checkbox.
3. Tick **Enable SSH service**.
4. Leave the port as **22** unless you have a reason to change it.
5. Click **Apply** / **Save**.

> **Is this safe?** Yes, as long as your NAS isn't exposed directly to the internet. SSH is only reachable from inside your home/office network. If you want, you can turn SSH back off after the install is finished — the app keeps running without it.

---

## Step 2: Install Docker on the NAS

Docker is the thing that actually runs the app.

1. In the NAS web interface, open the **App Center** (or **App Store**).
2. Search for **Docker**.
3. Click **Install** and wait for it to finish.

If Docker is already installed, skip this step.

---

## Step 3: Find your NAS's IP address

You need this to connect.

- In the NAS web interface, look in **Control Panel → Network**, or check the address bar of your browser right now — if it says something like `http://192.168.1.50`, then `192.168.1.50` is your NAS IP.

Write it down. Everywhere below where I write `192.168.1.50`, **replace it with your actual IP**.

---

## Step 4: Connect to the NAS with SSH

### On Windows

1. Click Start, type **PowerShell**, press Enter.
2. In the black window, type this and press Enter (replace the IP and username):

```
ssh admin@192.168.1.50
```

### On Mac

1. Press `Cmd + Space`, type **Terminal**, press Enter.
2. Type the same command:

```
ssh admin@192.168.1.50
```

### What happens next

- The first time, you'll see a message about "authenticity of host... can't be established" and a question ending in `(yes/no)?`. Type **yes** and press Enter. This is normal and only happens once.
- It will ask for your password. **Type your NAS admin password and press Enter.** You will see *nothing at all* while typing — no dots, no stars. That's normal, it's still registering. Just type it and hit Enter.

**You should now see** a prompt that looks something like `admin@UGREENNAS:~$`. You're in. Every command from here on gets typed into this window.

> **If it says "Connection refused":** SSH isn't on yet — go back to Step 1.
> **If it says "Permission denied":** wrong username or password. Use the same ones as the NAS web login.

---

## Step 5: Check Docker works, and find where to put things

Copy and paste this, press Enter:

```
docker --version
```

**You should see** something like `Docker version 24.0.7, build afdd53b`.

> **If it says "permission denied"** — you'll need to put `sudo ` in front of every `docker` command in this guide (so `sudo docker --version`, `sudo docker compose up -d --build`, etc.). It will ask for your password the first time. That's fine and normal.
>
> **If it says "command not found"** — Docker didn't install correctly. Go back to Step 2.

Now find your storage volume:

```
ls /
```

**You should see** a list that includes something like `volume1` or `volume2`. Most Ugreen NAS units use `volume1`. Everywhere below I write `/volume1`, replace it if yours is different.

---

## Step 6: Download the app onto the NAS

### 6a. Make a folder for it

```
mkdir -p /volume1/docker
cd /volume1/docker
```

**You should see** no output at all. That means it worked. (In terminals, silence = success.)

### 6b. Create a GitHub access token

Because your repository is **private**, the NAS needs permission to download it. GitHub no longer accepts your normal password for this, so you create a one-off "token" that acts as a password.

On your computer, in a browser:

1. Go to https://github.com/settings/tokens
2. Click **Generate new token** → **Generate new token (classic)**
3. **Note:** type something like `ugreen-nas`
4. **Expiration:** choose whatever you like (90 days is fine; you'd just make a new one later)
5. **Select scopes:** tick the box named **`repo`** (the top one — it selects the sub-items automatically)
6. Scroll down, click **Generate token**
7. **Copy the token now** — it looks like `ghp_xxxxxxxxxxxxxxxxxxxx`. GitHub will never show it to you again. Paste it somewhere safe for the next minute.

### 6c. Download the code

Back in the SSH window, paste this:

```
git clone https://github.com/Changzer/mbarete-app.git
```

> **Following Option B from Step 0 instead (not merging)?** Use this command instead:
> ```
> git clone -b claude/trading-internal-tool-bzi4h6 https://github.com/Changzer/mbarete-app.git
> ```

It will ask for:
- **Username:** `Changzer`
- **Password:** paste the `ghp_...` token (again, you'll see nothing as you paste — that's normal)

**You should see** lines like `Cloning into 'mbarete-app'...` and `Resolving deltas: 100%`.

> **If it says `git: command not found`** — your NAS doesn't have git. Skip to the **"No git on the NAS?"** section at the bottom of this guide, then come back to Step 7.

Now move into the folder:

```
cd /volume1/docker/mbarete-app
```

Check the code is really there:

```
ls
```

**You should see** a list including `Dockerfile`, `docker-compose.yml`, `package.json`, `src`. If you only see `README.md`, you cloned `main` before merging the PR — go back and do Step 0.

---

## Step 7: Create your settings file

The app needs three things: a secret key, and the email + password for your login.

### 7a. Generate the secret key

```
openssl rand -base64 32
```

**You should see** a random line like `k3Jd8fMx2pQ9vN1wR7tY4uI6oP0aS5dF8gH2jK3lM9n=`.

**Copy that whole line** — you'll paste it in a second.

> **If `openssl` isn't found**, use this instead:
> ```
> docker run --rm node:22-alpine node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
> ```

### 7b. Write the settings file

Now you'll create the file. Type this to open a simple text editor:

```
nano .env
```

A blue-ish editor fills the screen. Type (or paste) these four lines, replacing the values:

```
AUTH_SECRET=paste-the-random-line-from-step-7a-here
ADMIN_EMAIL=you@yourcompany.com
ADMIN_PASSWORD=pick-a-strong-password
ADMIN_NAME=Your Name
```

Important notes:
- **No spaces around the `=` signs.**
- **No quotes** around the values.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` are what you'll use to log into the app. Pick a real password you'll remember — this is your login.

Optional extra lines — AI photo transcription. With a provider key set, the
product form reads market photos (product + handwritten price board) and the
contact form reads business cards, pre-filling the fields for you to check.
Skip them and the app simply works without those features.

Moonshot/Kimi (recommended when the server runs in mainland China; key from
https://platform.moonshot.cn):

```
MOONSHOT_API_KEY=sk-your-key-here
MOONSHOT_MODEL=kimi-k2.6
```

Or Anthropic/Claude (works anywhere with access to api.anthropic.com; key
from https://console.anthropic.com):

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

To save and close:
1. Press `Ctrl + O` (the letter O), then Enter — this saves.
2. Press `Ctrl + X` — this exits.

Double-check it saved correctly:

```
cat .env
```

**You should see** your four lines printed back.

---

## Step 8: Build and start the app

This is the big one. Paste:

```
docker compose up -d --build
```

**This takes 5–20 minutes the first time** — longer on a slow or heavily-filtered connection, where downloading the Node packages is the bottleneck. You'll see a lot of scrolling text and long pauses on individual steps; that's normal. Let it run and don't close the window.

This is a **one-time cost**. Docker caches each step, so later updates only redo what actually changed — usually under a minute unless dependencies changed.

**You should see**, at the end, something like:
```
[+] Running 3/3
 ✔ Volume "mbarete-app_mbarete-data"     Created
 ✔ Volume "mbarete-app_mbarete-uploads"  Created
 ✔ Container mbarete-app-mbarete-app-1   Started
```

> **If `docker compose` says "is not a docker command"**, your Docker is older. Use `docker-compose` (with a hyphen) instead:
> ```
> docker-compose up -d --build
> ```

### Check it's actually running

```
docker compose ps
```

**You should see** your container listed with status **`Up`** or **`running`**.

Now check the startup log:

```
docker compose logs
```

**You should see** lines including:
```
[seed] created initial user you@yourcompany.com
[seed] created starter categories
▲ Next.js 16.3.1
- Local:  http://localhost:3000
```

That `[seed] created initial user` line is the important one — it means your login was created successfully.

---

## Step 9: Open the app

On any computer or phone on the same network, open a browser and go to:

```
http://192.168.1.50:3000
```

(Your NAS IP, then `:3000`.)

**You should see** the Mbarete sign-in page.

Log in with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` you set in Step 7b.

You're done. 🎉

Click **中文** in the top right to switch to Chinese at any time.

---

## First things to do in the app

1. Go to **Catalog → Manage Categories** and set up your real product categories (in both English and Chinese).
2. Go to **Catalog → Add Product** and add a product or two.
3. Go to **Contacts** and add a supplier and a client.
4. Go to **Orders → New Order** and try building an order.

---

## Everyday operations

All of these are run from the app folder. If you've just reconnected via SSH, get there first:

```
cd /volume1/docker/mbarete-app
```

| What you want | Command |
|---|---|
| See if it's running | `docker compose ps` |
| See the logs (for troubleshooting) | `docker compose logs --tail 50` |
| Stop the app | `docker compose down` |
| Start it again | `docker compose up -d` |
| Restart it | `docker compose restart` |
| Update to a newer version | `git pull` then `docker compose up -d --build` |

**The app starts automatically when your NAS reboots** — you don't need to do anything after a power cut or restart.

---

## Updating itself automatically

Instead of connecting by SSH every time something is merged, you can have the
NAS follow the `main` branch on its own. It checks every few minutes and
rebuilds only when the branch has actually moved.

Set it up once:

```
cd /volume1/docker/mbarete-app
sudo ./scripts/install-auto-update.sh
```

That's it. To check every 15 minutes instead of every 5:

```
sudo ./scripts/install-auto-update.sh 15
```

### What it does when something is merged

1. Notices that `main` has moved.
2. Updates the code and rebuilds the app.
3. Waits for the app to answer, for up to two minutes.
4. If it answers, you're done — the new version is live.
5. **If it doesn't answer, it puts the previous version back**, so the NAS is
   never left down while nobody is watching.

A version that fails is not tried again, so a broken merge cannot put the NAS
into a rebuild loop. Push a fix to `main` and the next check picks it up.

If the *build* fails rather than the app, nothing is disturbed at all — the
version that is already running keeps running.

### Keeping an eye on it

```
tail -f /volume1/docker/mbarete-app/auto-update.log
```

A quiet log is a good sign: nothing is written when there is nothing to do.
You'll see entries like:

```
2026-08-18 14:02:11  update found on main: 4d98ddd Fix order totals
2026-08-18 14:02:11  rebuilding
2026-08-18 14:04:36  deployed 4d98ddd and the app is answering
```

Other useful commands:

| What you want | Command |
|---|---|
| Check for updates right now | `sudo systemctl start mbarete-auto-update.service` |
| See when it last ran | `systemctl status mbarete-auto-update.timer` |
| Turn it off | `sudo ./scripts/install-auto-update.sh --uninstall` |

### Things worth knowing

- **Your settings are safe.** `.env` is never touched, and your products,
  orders and photos live in Docker volumes that updates don't go near.
- **Anything you edit on the NAS by hand gets set aside**, not deleted. The
  log tells you when this happens, and `git stash list` shows what was kept.
- **It needs a git clone.** If you installed from a ZIP instead, auto-update
  has nothing to follow — see the next section for that route.
- **The NAS still needs to reach GitHub.** If it can't, the updater logs the
  outage and tries again on the next check; nothing breaks.
- **It rebuilds without asking.** Anything merged into `main` goes live within
  minutes, so treat merging as deploying.

---

## Updating when the NAS cannot reach GitHub

GitHub is unreliable or blocked from some networks. If `git pull` on the NAS
fails with a timeout while `nslookup github.com` returns a correct address
(`20.x.x.x`), the NAS simply cannot reach GitHub — nothing is broken locally.

Confirm with:

```
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 15 https://github.com
```

`000` after a long pause means blocked. In that case update from your own
computer instead, which can reach both GitHub and the NAS.

**1. On your computer**, download the code: go to
https://github.com/Changzer/mbarete-app → green **Code** button → **Download ZIP**.

**2. Copy it to the NAS** from PowerShell (replace the address with your NAS's):

```
scp $HOME\Downloads\mbarete-app-main.zip changzer@100.114.174.9:/volume1/docker/
```

**3. On the NAS**, run the updater:

```
cd /volume1/docker/mbarete-app
./scripts/update-from-zip.sh /volume1/docker/mbarete-app-main.zip
```

It keeps your `.env`, backs up the previous version alongside the app folder,
and rebuilds. Your products, orders and photos are in Docker volumes and are
not touched. The command to roll back is printed at the end.

> If `./scripts/update-from-zip.sh` says "Permission denied", run
> `chmod +x scripts/update-from-zip.sh` once.

### Or route git through a proxy

If you run a proxy (Clash, v2ray) on another machine on your Tailscale network,
git can use it instead. Get that machine's address by running `tailscale ip -4`
**on that machine** — not inside the NAS SSH session, which would report the
NAS itself. Enable "Allow LAN" in the proxy, then test before committing to it:

```
curl -x http://PROXY_ADDRESS:7890 -sS -o /dev/null -w "%{http_code}\n" --max-time 10 https://github.com
```

Only if that prints `200`:

```
git config --global http.proxy http://PROXY_ADDRESS:7890
git config --global https.proxy http://PROXY_ADDRESS:7890
```

Undo with `git config --global --unset http.proxy` (and `https.proxy`). Note
this only works while that machine is on and the proxy is running.

---

## Backing up your data

Your products, orders, contacts, and uploaded images live in Docker volumes, separate from the code. They survive updates and restarts.

To make a backup file you can copy somewhere safe:

```
cd /volume1/docker/mbarete-app
docker run --rm -v mbarete-app_mbarete-data:/data -v mbarete-app_mbarete-uploads:/uploads -v /volume1/docker:/backup alpine tar czf /backup/mbarete-backup-$(date +%Y%m%d).tar.gz /data /uploads
```

**You should see** no output, and a new file appears at `/volume1/docker/mbarete-backup-YYYYMMDD.tar.gz`. Copy that file somewhere safe (another drive, cloud storage) using the NAS File Manager.

Worth doing once a month, or before any update.

> ⚠️ **Never run `docker compose down -v`.** The `-v` deletes your volumes — meaning every product, order, and contact you've entered. Plain `docker compose down` is always safe.

---

## Troubleshooting

**The page won't load / "can't reach this site"**

Check the container is actually up:
```
cd /volume1/docker/mbarete-app && docker compose ps
```
If it's not listed as running, check why:
```
docker compose logs --tail 50
```

**"Port is already allocated" when starting**

Something else on the NAS is using port 3000. Change the app to a different port:
```
nano docker-compose.yml
```
Find the line `      - "3000:3000"` and change the **first** number only, e.g. `      - "3100:3000"`. Save with `Ctrl+O`, Enter, `Ctrl+X`. Then:
```
docker compose up -d
```
Now use `http://192.168.1.50:3100` instead.

**I forgot my app password**

Stop the app, delete the database, and it'll recreate the login from your `.env` file on next start. ⚠️ **This erases all products, orders, and contacts** — only do this if you're still setting up:
```
cd /volume1/docker/mbarete-app
docker compose down
docker volume rm mbarete-app_mbarete-data
docker compose up -d
```

**Changing the admin password (without losing data)**

Not currently possible through the app — there's no user-management screen yet. Ask for one to be added if you need it.

**The build failed partway through**

Usually a network hiccup while downloading. Just run it again:
```
docker compose up -d --build
```

**The build fails immediately with "failed to resolve source metadata for docker.io/library/node:22-alpine"**

The build never reached the app's code — Docker couldn't download the base image it builds on top of. Look at the very end of the error message:

- **If it mentions `proxyconnect` and a hostname that looks like placeholder text** (e.g. `lookup YOUR_PC_TAILSCALE_IP ... no such host`), your NAS's Docker is set to route through a proxy that was never filled in properly. Find where it's configured:

  ```
  sudo grep -rn "proxy\|Proxy" /etc/docker/daemon.json /root/.docker/config.json ~/.docker/config.json /etc/systemd/system/docker.service.d/ 2>/dev/null
  ```

  Then remove the bad proxy setting from whichever file it's in (see below), and restart Docker:

  ```
  sudo systemctl restart docker
  ```

  In `/etc/docker/daemon.json` the offending part looks like a `"proxies"` block — delete that block, keeping the rest of the file (and keeping it valid JSON — no trailing commas):

  ```json
  {
    "registry-mirrors": ["https://docker.mirrors.ustc.edu.cn"],
    "proxies": {                                    <-- delete
      "http-proxy": "http://YOUR_PC_TAILSCALE_IP:1080",     <-- delete
      "https-proxy": "http://YOUR_PC_TAILSCALE_IP:1080"     <-- delete
    }                                               <-- delete
  }
  ```

  In `/etc/systemd/system/docker.service.d/http-proxy.conf` it's an `Environment="HTTP_PROXY=..."` line — delete the file entirely if that's all it contains, then `sudo systemctl daemon-reload && sudo systemctl restart docker`.

- **If it mentions a mirror like `docker.mirrors.ustc.edu.cn` timing out**, the registry mirror your NAS uses is down or unreachable. Edit `/etc/docker/daemon.json`, remove the `"registry-mirrors"` line so Docker goes to Docker Hub directly, and restart Docker.

Either way, confirm the fix before rebuilding:

```
docker pull node:22-alpine
```

**You should see** it download and finish with `Status: Downloaded newer image for node:22-alpine`. Once that works, `docker compose up -d --build` will work too.

> Restarting Docker briefly stops any *other* containers on your NAS. They'll come back automatically.

---

## No git on the NAS?

If Step 6c said `git: command not found`, do this instead:

1. On your **computer**, go to https://github.com/Changzer/mbarete-app
2. If you merged the PR (Option A), make sure the branch dropdown says **main**. If not, switch it to `claude/trading-internal-tool-bzi4h6`.
3. Click the green **Code** button → **Download ZIP**.
4. Open your NAS **File Manager** in the browser, navigate to the `docker` shared folder, and **upload the ZIP** there.
5. Back in the SSH window:

```
cd /volume1/docker
unzip mbarete-app-main.zip
mv mbarete-app-main mbarete-app
cd mbarete-app
```

(The ZIP's exact filename may differ — run `ls` to see what it's actually called and adjust.)

Then continue from **Step 7**.

Note that with this method, `git pull` won't work for updates — you'd repeat the download-and-replace process instead (keep your `.env` file!).

---

## Making it reachable outside your network

This guide sets the app up for your **local network only**, which is the safe default for an internal tool.

If you later want to reach it from outside the office, **don't** just forward port 3000 on your router — the app would be exposed to the whole internet over plain HTTP. Instead, either:

- Use **Tailscale with HTTPS** — the setup in [Turning on HTTPS](#turning-on-https--unlocks-full-offline-mode) below covers exactly this, is what the team already uses to reach the NAS from China, and unlocks the app's full offline mode as a bonus, or
- Use a **VPN** into your network (Ugreen NAS units typically have a VPN Server app), or
- Put it behind a **reverse proxy with HTTPS** (Nginx Proxy Manager, Traefik, or Ugreen's built-in reverse proxy if your model has one) so traffic is encrypted.

Either way, keep the admin password strong.

---

## Turning on HTTPS — unlocks full offline mode

Out of the box the app is reached over plain HTTP (`http://NAS-IP:3000` or the
Tailscale IP). That works, but browsers hold one feature hostage until an app
lives on HTTPS: the **service worker**, the piece that can serve pages from
the phone itself when there is no connection.

What that means in practice:

| | Plain HTTP (now) | HTTPS (after this section) |
|---|---|---|
| Capturing products/cards offline | ✅ works, if the capture page was opened before the signal died | ✅ works |
| Offline catalog copy from the pill | ✅ works | ✅ works |
| Reloading a page while offline | ❌ browser error | ✅ loads from the phone |
| Opening the home-screen icon in a dead hall | ❌ nothing loads | ✅ opens like a real app |
| Phone protecting the capture queue from storage cleanup | ❌ not available | ✅ requested automatically |

Since the team already reaches the NAS over Tailscale, the free way to get
HTTPS is Tailscale's own `serve` — it gives the NAS a private, valid
certificate on your tailnet. **Only devices signed into your Tailscale network
can reach it**; nothing is exposed to the internet.

### 1. One-time switches in the Tailscale admin page

On a computer, open <https://login.tailscale.com/admin/dns> and check two
things on that page:

1. **MagicDNS** is enabled.
2. **HTTPS Certificates** is enabled (a toggle further down the same page).

Both are one-click and free.

### 2. Find your NAS's Tailscale name

In the NAS SSH session:

```
tailscale status
```

The first line of the list is the NAS itself. Its full name is the machine
name plus your tailnet's domain, e.g. `ugreen-nas.tail1a2b3c.ts.net` — and
you don't need to guess it: the command in the next step prints the exact
address when it succeeds.

### 3. Put the app behind Tailscale's HTTPS

Still in the SSH session:

```
sudo tailscale serve --bg 3000
```

**You should see** it confirm something like:

```
Available within your tailnet:
https://ugreen-nas.tail1a2b3c.ts.net/
|-- proxy http://127.0.0.1:3000
```

That's it — Tailscale fetches the certificate itself on the first visit
(the very first page load can take a few extra seconds while it does).

`--bg` makes it permanent: it survives reboots, and `tailscale serve status`
shows it any time. To undo it: `tailscale serve reset`.

> If Tailscale runs on your NAS as a **Docker container** rather than an
> installed app, run the same command inside that container, pointing at the
> NAS's LAN address instead of 127.0.0.1:
> `docker exec tailscale tailscale serve --bg http://192.168.1.50:3000`
> (your container name and NAS IP may differ).

### 4. Move the phones over — once, properly

Browser storage is tied to the exact address, so the queue and the offline
copy do not follow from the old `http://...` address to the new one. On each
phone, in this order:

1. **Drain first.** On the old address, make sure the amber pill is gone
   (no captures still waiting on the phone).
2. Open `https://ugreen-nas.tail1a2b3c.ts.net` (your name from step 2) in the
   phone's browser and sign in.
3. **Add to Home Screen** from this address, and from now on always use the
   icon. Delete the old icon/bookmark so there is only one address in use.
4. Open the icon, sign in inside it, and while still connected visit the pages
   used at the market once — Catalog, and Catalog → Add Product. Visited
   pages are what the phone can re-open offline.

### 5. Prove it worked

With the phone in **airplane mode**: open the home-screen icon.

**You should see** the catalog load anyway — served by the phone. Add Product
opens too; captures save to the phone and upload themselves once you're back
online, same as before.

Two honest limits remain even on HTTPS:

- A page never visited while online has nothing cached to show offline.
- Live data on a page (today's stock of drafts, another user's new products)
  is as fresh as the last online visit. Capturing is unaffected — captures
  never depend on the page being fresh.
