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

## Notes on the data model

- **Products**: priced in any currency (`price` + `currency`), with MOQ, quantity-per-box, dimensions (auto-computes CBM, override allowed), weight, and a bilingual name/description.
- **Orders**: built by picking products and quantities; totals (price converted to a chosen display currency via the `exchange_rates` table, CBM, weight) are computed live. A line below its product's MOQ is flagged and blocks confirming the order (saving as a draft is still allowed). Orders move through `draft → confirmed → shipped` (or `cancelled`).
- **Contacts**: suppliers and clients share one table (`type` column), with company name, contact person, phone, email, WhatsApp, and WeChat.
