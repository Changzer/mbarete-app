# Mbarete

Sourcing/procurement tool for wholesale trading — a bilingual (EN/中文) product catalog, order builder with MOQ/CBM/weight calculations, a supplier/client directory, order exports (XLSX/PDF quotes), and a finance report. Runs as a single-company install on a home NAS, or as a multi-company (SaaS) deployment.

> **Installing this on the NAS?** Follow **[INSTALL.md](INSTALL.md)** — a complete step-by-step walkthrough over SSH, written for non-technical users. The rest of this README is developer reference.

## Stack

- **Next.js 16 (App Router) + TypeScript** — one process serves both the UI and the API.
- **PostgreSQL 16 via Drizzle ORM + node-postgres** — multi-tenant: every business row carries a `company_id`, enforced three deep (scoped queries, composite tenant foreign keys, and Postgres row-level security that fails closed).
- **Auth.js (NextAuth) v5**, email + password credentials login. Two roles per company: `admin` and `collaborator`; each company has a permanent owner. Self-hosted installs seed one company from env; `DEPLOY_MODE=saas` opens an invite-code-gated `/signup` that creates a company + owner.
- **next-intl** — English / Chinese, locale-prefixed routes (`/en/...`, `/zh/...`).
- **Tailwind CSS**, hand-rolled UI primitives on top of Radix UI.
- **exceljs / pdfkit / archiver** — order quote exports (XLSX + CJK-capable PDF) and the admin backup zip (all CSVs + all uploaded files, streamed).

## Local development

```bash
npm install
cp .env.example .env.local   # fill in AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run dev
```

Local dev needs a Postgres 16 server; `DATABASE_URL` defaults to
`postgres://mbarete:mbarete@localhost:5432/mbarete`. On first boot the app
automatically runs pending Drizzle migrations and — in self-hosted mode —
seeds the install's company, the initial admin/owner (from `ADMIN_EMAIL` /
`ADMIN_PASSWORD` / `ADMIN_NAME`), starter categories, and starter exchange
rates (editable later in Settings, refreshed daily from keyless forex
providers). In `DEPLOY_MODE=saas` nothing is seeded — companies come from
`/signup`, gated by `SIGNUP_CODE`.

If the migration runner connects as a superuser (docker's bootstrap role), it
maintains a non-superuser `<user>_app` login for the app so row-level
security actually binds — see the "Row-level security" section of INSTALL.md.

Uploaded images live under `./uploads` (override with `UPLOADS_DIR`),
deliberately outside `public/`; the `/uploads/...` route serves them with
per-tenant auth and on-the-fly resizing.

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

This builds a small Alpine-based image and starts two containers — the app
and a bundled PostgreSQL 16 (reachable only on the compose network) — with
three named volumes:

- `mbarete-pgdata` → the Postgres data directory
- `mbarete-uploads` → `/app/uploads` (photos, cards, documents, slips)
- `mbarete-data` → `/app/data` (the SQLite era's `mbarete.db`, read once by `npm run db:import-sqlite` and kept as a backup)

All persist across `docker compose down` / rebuilds — only `docker compose down -v` would remove them.

The app listens on port 3000 (`http://<nas-ip>:3000`). Put it behind whatever reverse proxy / HTTPS termination you already run on the NAS (Nginx Proxy Manager, Traefik, Synology/Ugreen's own reverse proxy app, etc.) if you want a real hostname or HTTPS.

Generate `AUTH_SECRET` with:

```bash
openssl rand -base64 32
```

### First login

Sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set in `.env` — that account is created automatically on first boot and owns the install's company. Add teammates from **Settings → Users** (admins create accounts and assign the `admin` / `collaborator` role; the owner can never be demoted or deactivated).

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
  HTTPS (`sudo tailscale serve --bg 3000` on the NAS) turns on the bundled
  service worker, after which previously-visited pages also survive a full
  reload offline — including cold-opening the home-screen icon — and the
  browser can be asked to protect the outbox from eviction. The step-by-step
  setup, including moving the phones to the new address, is in
  [INSTALL.md → Turning on HTTPS](INSTALL.md#turning-on-https--unlocks-full-offline-mode).

Editing (products, orders, contacts) stays online-only on purpose: an edit
delivered days later could silently overwrite someone's newer work. Offline
is for *capturing new things*, which is what the market floor needs.

## Notes on the data model

- **Products**: priced in any currency (`price` + `currency`), with MOQ, quantity-per-box, dimensions (auto-computes CBM, override allowed), weight, and a bilingual name/description.
- **Orders**: built by picking products and quantities; totals (price converted to a chosen display currency via the `exchange_rates` table, CBM, weight) are computed live. A line below its product's MOQ is flagged and blocks confirming the order (saving as a draft is still allowed). Orders move through `draft → confirmed → shipped` (or `cancelled`). A draft is a quote (报价): the finance report books expected revenue and receivables only from confirmed/shipped orders (下单), showing drafts separately as the quoted pipeline. Real cash (payments, expenses) counts whatever the status.
- **Contacts**: suppliers and clients share one table (`type` column), with company name, contact person, phone, email, WhatsApp, and WeChat.

- Accountant pack: one ZIP per period — report, ledgers, evidence files, SHA-256 manifest, and tamper-evident period closes
