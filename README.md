# Mbarete

Internal tool for Mbarete's sourcing/procurement business — a bilingual (EN/中文) product catalog, order builder with MOQ/CBM/weight calculations, and a supplier/client directory. Built to self-host cheaply on a home NAS.

> **Installing this on the NAS?** Follow **[INSTALL.md](INSTALL.md)** — a complete step-by-step walkthrough over SSH, written for non-technical users. The rest of this README is developer reference.

## Stack

- **Next.js 16 (App Router) + TypeScript** — one process serves both the UI and the API.
- **SQLite via Drizzle ORM + better-sqlite3** — a single file on disk, no separate database service.
- **Auth.js (NextAuth) v5**, credentials login — one shared internal account (or a few), no self-registration.
- **next-intl** — English / Chinese, locale-prefixed routes (`/en/...`, `/zh/...`).
- **Tailwind CSS**, hand-rolled UI primitives on top of Radix UI.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run dev
```

On first boot the app automatically runs pending Drizzle migrations and seeds:
- the initial admin user (from `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME`)
- three starter categories
- starter exchange rates (`USD`, `CNY`) — edit these directly in the `exchange_rates` table, or extend the app with a settings screen if you want it editable in the UI.

The SQLite file and uploaded product images are stored under `./data` and `./public/uploads` respectively in local dev (override with `DATABASE_DIR`).

### Adding a database column / table

Edit `src/db/schema.ts`, then:

```bash
npm run db:generate   # writes a new SQL migration into ./drizzle
```

Migrations apply automatically on the next server boot (see `instrumentation.ts`).

## Deploying with Docker (Ugreen NAS)

```bash
cp .env.example .env      # fill in AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d --build
```

This builds a single ~small Alpine-based image and starts one container, with two named volumes:

- `mbarete-data` → `/app/data` (the SQLite database)
- `mbarete-uploads` → `/app/public/uploads` (product images)

Both persist across `docker compose down` / rebuilds — only `docker compose down -v` would remove them.

The app listens on port 3000 (`http://<nas-ip>:3000`). Put it behind whatever reverse proxy / HTTPS termination you already run on the NAS (Nginx Proxy Manager, Traefik, Synology/Ugreen's own reverse proxy app, etc.) if you want a real hostname or HTTPS.

Generate `AUTH_SECRET` with:

```bash
openssl rand -base64 32
```

### First login

Sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set in `.env` — that account is created automatically on first boot. To add teammates, either extend the app with a user-management screen, or insert rows into the `users` table directly (password hashed with bcrypt).

### Updating

```bash
git pull
docker compose up -d --build
```

The container re-runs migrations automatically on startup; existing data in the volumes is untouched.

## Offline capture (market mode)

Connectivity at Yiwu or the Canton Fair is assumed to be bad. The capture
workflow — photograph, save, next booth — therefore never depends on it:

- Registering a product or a supplier card when the server is unreachable
  saves the capture **to the phone** (IndexedDB) instead of failing. The form
  clears immediately and a pill shows "N captures on this phone".
- The outbox delivers queued captures on its own — when the network returns,
  when the app comes back to the foreground, and on a slow sweep. Every
  capture carries a client-minted id, so a delivery that succeeded but lost
  its response is replayed harmlessly (`/api/drafts` answers "already have
  it" instead of creating a twin). A 2xx only counts as delivered when the
  response body is provably ours — venue wi-fi captive portals answer 200 to
  anything.
- Delivered captures land in **Catalog → Drafts** as capture drafts. The
  server runs the AI reading over the photos on arrival (when a provider key
  is configured), so drafts come pre-filled: open a product draft in the
  normal form to proofread and save; import a card draft as a contact with
  one tap.
- While offline, the pill also opens a **read-only catalog copy** (text only,
  refreshed every time the full catalog page is viewed online) for "do we
  already buy this, and at what price?" at the booth.

Rules that keep this reliable — worth telling every agent:

- **One address.** The queue and the offline copy live in the browser's
  storage *for the address the app was opened on*. `http://192.168.x.x:3000`
  and the Tailscale IP are two different worlds; captures saved on one are
  invisible on the other. Pick one address (the Tailscale one) and bookmark
  it everywhere.
- **Install the icon, then sign in inside it** (Add to Home Screen). An iOS
  home-screen app has its own storage, separate from Safari — captures made
  in a Safari tab are invisible from the icon and vice versa. Install first,
  sign in inside the installed app, and always capture from the icon.
- **Sync before the trip ends.** The phone is the only copy until the queue
  drains — a lost or wiped phone loses whatever was still waiting. iOS can
  also evict a site's storage after ~7 days of Safari use with no visit. The
  pill going away means everything is on the NAS.
- **Own devices only.** The offline catalog copy (with prices) and any queued
  captures live in the browser's storage and are not removed by signing out —
  deleting them on sign-out would also delete captures that never reached the
  server. Don't sign in from a shared or borrowed browser.
- The app stays usable offline only while it is **already open** — over plain
  HTTP no browser lets a page load with zero connectivity. Keep the tab/app
  open through the halls (it survives backgrounding). Putting the app behind
  HTTPS (e.g. `tailscale serve --bg https / http://127.0.0.1:3000` on the
  NAS) turns on the bundled service worker, after which previously-visited
  pages also survive a full reload offline and the browser can be asked to
  protect the outbox from eviction.

Editing (products, orders, contacts) stays online-only on purpose: an edit
delivered days later could silently overwrite someone's newer work. Offline
is for *capturing new things*, which is what the market floor needs.

## Notes on the data model

- **Products**: priced in any currency (`price` + `currency`), with MOQ, quantity-per-box, dimensions (auto-computes CBM, override allowed), weight, and a bilingual name/description.
- **Orders**: built by picking products and quantities; totals (price converted to a chosen display currency via the `exchange_rates` table, CBM, weight) are computed live. A line below its product's MOQ is flagged and blocks confirming the order (saving as a draft is still allowed). Orders move through `draft → confirmed → shipped` (or `cancelled`).
- **Contacts**: suppliers and clients share one table (`type` column), with company name, contact person, phone, email, WhatsApp, and WeChat.
