# Migrations: how this folder actually works

**Hand-written SQL is the single source of truth.** From `0006` onward,
migrations are written by hand and registered by hand in
`meta/_journal.json`. The Drizzle snapshot files under `meta/` stop at
`0007` and are deliberately NOT maintained.

That has one hard consequence:

> **Never run `drizzle-kit generate` (`db:generate`).** It would diff
> `src/db/schema.ts` against the stale `0007` snapshot and emit a migration
> that tries to re-create six generations of already-applied schema. If it
> is ever wanted again, the snapshot chain must first be rebuilt against the
> real current schema — a deliberate project, not a side effect.

## Adding a migration

1. Write `NNNN_short-name.sql` in this folder. Multiple statements are
   fine; add `--> statement-breakpoint` between DDL statements the way the
   existing files do.
2. Append an entry to `meta/_journal.json`: next `idx`, `"version": "7"`,
   a fresh `when` (ms epoch, strictly increasing), `tag` = the filename
   without `.sql`, `"breakpoints": true`. A unit test fails the build if
   the journal and the SQL files ever disagree.
3. Mirror the change in `src/db/schema.ts` so the TypeScript view of the
   schema matches what the SQL built.
4. New tables holding tenant data need RLS policies in the same migration —
   `npm run check:isolation` will catch a bare one.
5. Test BOTH paths before shipping: a fresh empty database
   (`npm run db:migrate` against a new DB — CI does this on every run) and
   an upgrade of an existing database that already has everything up to the
   previous migration.

## Rules learned the hard way

- **Never amend a migration that has shipped.** The NAS records it as
  applied by tag and will not run it again — an edit silently never
  reaches production. Ship a new migration instead (the `extra_seats`
  column once had to be rescued out of an amended `0010` into a new
  `0011` for exactly this reason).
- Migrations run at boot before the app serves, as the admin role
  (`src/db/migrate.ts`), and since the backup hardening a boot with
  pending migrations takes a fresh backup first and refuses to proceed
  if that backup fails.
