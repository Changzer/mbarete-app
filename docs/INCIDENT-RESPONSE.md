# Incident response runbook

For the operator, written to be followed at 2am. Covers security incidents
and data breaches; the ordinary-outage path is in INSTALL.md ("Knowing when
it breaks").

## 1. Detection — how you find out

- **Heartbeat silence**: healthchecks.io emails when the app stops pinging
  (crash, dead DB, dead server).
- **Error alerts**: first sighting of a new server error emails
  `ALERT_EMAIL`; the platform panel shows the last 24h of errors.
- **Login brakes**: repeated failures lock (IP, email) pairs and then the
  IP — a credential-stuffing attempt burns itself out, but panel activity
  and mail from affected users are your signal.
- **A user reports something odd.** Treat "I saw data that isn't mine" as a
  P0 until disproven — RLS makes it near-impossible, which makes any real
  sighting critical.

## 2. Containment — stop the bleeding first

In escalating order; do the least that contains it:

```sh
# Freeze one company (suspected compromised account):
#   platform panel → company → Freeze. Their admin keeps the backup export.

# Kill all sessions platform-wide (suspected credential/secret leak):
#   set a NEW AUTH_SECRET in .env, then:
docker compose up -d          # every session cookie dies at once

# Rotate the database password (suspected DB credential leak):
docker compose exec mbarete-db psql -U mbarete -d mbarete -c "ALTER ROLE mbarete PASSWORD '<new>';"
#   put the same value in .env DB_PASSWORD, then: docker compose up -d
#   (the boot re-syncs the app role's password automatically)

# Take the service offline entirely (active exploitation):
docker compose stop mbarete-app
#   the database and uploads volumes stay intact; backups keep their schedule
```

Close the provider firewall to ports other than 22/80/443 if it is not
already (it should be — see SERVER-MIGRATION.md).

## 3. Assessment — what actually happened

- `docker compose logs --since <time>` for the window in question.
- The platform panel's error log for server-side traces.
- `entity_events` (per-company audit trail) answers who touched which
  records and when; order changelogs answer the same for orders.
- Backups are daily and integrity-checked: `docs/BACKUPS.md` §restore lets
  you diff today's data against yesterday's to see what changed.
- Scope the personal-information impact per the classification table in
  `docs/COMPLIANCE.md`: whose data, which classes, how many people.

## 4. Notification duties

- **China (PIPL Art. 57; 网络数据安全管理条例):** on a personal-information
  breach, remedy immediately and notify the performing authority and the
  affected individuals; where required, the report is expected promptly —
  treat **72 hours** as the outer bound and act sooner. If measures can
  effectively avoid harm, individual notification may be waived, but the
  authority may still require it.
- **Tenants:** their admins are told what of THEIR data was touched, in
  plain language, with what we did about it — regardless of thresholds.
- Keep a written timeline from the first signal onward; the timeline is
  half of every report.

## 5. Recovery

- Restore from the last clean backup if data was altered
  (`docs/BACKUPS.md`), on a fresh `AUTH_SECRET`.
- Re-admit frozen companies once their accounts are secured (password
  resets via the panel's reset-link tool).
- Verify: isolation suite green (`npm run check:isolation` against the
  production schema clone, never production itself), heartbeat green,
  error log quiet.

## 6. Afterwards

Write the postmortem in this repo (`docs/incidents/YYYY-MM-DD.md`): what
happened, the timeline, what contained it, what changes so it cannot
recur. The change lands as a PR like any other.
