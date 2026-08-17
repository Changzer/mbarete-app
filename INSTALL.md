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

**This takes 5–15 minutes the first time.** It's downloading and compiling everything. You'll see a lot of scrolling text — that's normal, let it run. Don't close the window.

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

- Use a **VPN** into your network (Ugreen NAS units typically have a VPN Server app — this is the safest option), or
- Put it behind a **reverse proxy with HTTPS** (Nginx Proxy Manager, Traefik, or Ugreen's built-in reverse proxy if your model has one) so traffic is encrypted.

Either way, keep the admin password strong.
