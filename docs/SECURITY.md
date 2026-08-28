# Security posture

An audit of the app as of 2026-08-25, done ahead of moving off the NAS onto a
public server. What holds, what was fixed, and what the operator must do.

## What holds (verified in code and by the isolation suite)

- **Tenant isolation is enforced in the database, not the app.** Postgres RLS
  with FORCEd policies on every business table; the app connects as a
  NOSUPERUSER/NOBYPASSRLS role; missing tenant context yields zero rows, and
  cross-tenant writes fail with 42501. `npm run check:isolation` proves both
  on every CI run. The platform panel reads across tenants through a
  deliberate SELECT-only policy, never around RLS.
- **Login is braked twice**: five wrong passwords lock the (IP, email) pair
  for 15 minutes (pair-keyed so nobody can lock out a victim's account), and
  30 failures lock the IP across all emails — credential stuffing loses login
  entirely. Unknown emails count too.
- **Signup is gated and braked**: SaaS mode only, 5 attempts/IP/hour, and
  admission requires the platform code or a valid referral code (31-char
  alphabet, 8+ chars — brute force is infeasible).
- **Tokens are real tokens**: invites and password-reset/verification links
  are 32 random bytes, stored only as SHA-256, single-use, expiring. Accept
  and forgot endpoints have their own per-IP/per-email brakes.
- **Uploads are private**: files are served through an authenticated route
  scoped to the session's company — a leaked URL is not access. Names are
  validated (no traversal), types come from an allowlist, sizes are capped,
  and the resize cache only accepts a fixed set of widths.
- **The platform panel does not exist** for anyone without the env-granted
  flag (404, not 403). The flag is RECONCILED at every boot from
  PLATFORM_ADMIN_EMAIL — changing the variable dethrones the old operator,
  unsetting it (with no ADMIN_EMAIL fallback) leaves nobody. Panel sessions
  pass the same validation as tenant sessions, so a password rotation or
  deactivation kills panel access identically. Cross-tenant WRITES (plans,
  seats, modules, backups) additionally demand step-up authentication: the
  operator's password again, opening a 15-minute window checked server-side
  on every mutation — a stolen signed-in session can look, not touch.
- **The company lifecycle binds at every boundary**: a pending (unapproved
  referral) or suspended company is turned away by the pages AND refused with
  403 by the API routes — captures, uploads, order exports, the accountant
  pack — so approval and freeze hold against direct API calls, not just the
  UI. The deliberate exceptions: a suspended admin keeps the full backup
  export, and upload serving stays readable to the owning session. Probed in
  the golden-path suite on every CI run.
- **Headers**: X-Frame-Options DENY, nosniff, same-origin referrer,
  restrictive Permissions-Policy, HSTS (inert on plain http, binding behind
  TLS).
- **Money-costing endpoints are limited**: tenant export 5/hour/user; AI
  transcription 120/hour/user (a cost brake, generous against real use).

## Fixed in this audit

- `npm audit` was reporting a high in nodemailer (transitively pinned by
  next-auth) and a moderate in exceljs's bundled uuid. Bumped nodemailer to
  9.x (our mailer uses only from/to/subject/text — the vulnerable `raw`
  path was never used) and forced uuid ≥11.1.1 via overrides. Audit is clean.
- **Login timing no longer reveals which emails exist**: an unknown email now
  burns the same bcrypt work as a wrong password.
- AI transcription gained the per-user cost brake above.
- HSTS added.

## Accepted trade-offs (known, deliberate)

- Signup says "email taken" — an enumeration vector, kept for UX. The signup
  brake (5/IP/hour) makes harvesting impractical.
- Rate limits are in-memory and reset on restart. Single-process app; a
  restart costs an abuser their progress, not us our safety.
- No Content-Security-Policy yet: Next's inline hydration needs per-request
  nonces — a project of its own, tracked for later.

## The operator's half (production checklist)

The app assumes a fronting TLS proxy on a public server. Non-negotiables:

1. **TLS in front** (Caddy/nginx/Traefik) — the session cookie is only
   `Secure` when the app is reached over https. Never expose port 3000 raw.
2. **Strong secrets**: `AUTH_SECRET` (32+ random bytes), a real
   `DB_PASSWORD`, an unguessable `SIGNUP_CODE`. Rotate anything that ever
   lived on the NAS `.env`.
3. **Postgres stays off the network** — compose-internal only, never a
   published port.
4. **Compliance & incidents** — data classification, consent enforcement,
   sub-processors and deferred items in docs/COMPLIANCE.md; the breach
   runbook in docs/INCIDENT-RESPONSE.md.
5. **Backups offsite** (docs/BACKUPS.md) — `BACKUP_DIR` on a different disk,
   synced off the machine.
5. Keep `DEPLOY_MODE`, `PLATFORM_ADMIN_EMAIL` deliberate: SaaS mode opens
   /signup; the platform email is the skeleton key to the panel.

The full move procedure lives in docs/SERVER-MIGRATION.md.

The accountant pack (`/api/export/accountant-pack`) is admin-only, gated on the finance module, rate-limited (10/hour per user), and internal by design — it contains cost data and must never feed a client-facing surface.
