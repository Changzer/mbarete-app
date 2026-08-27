-- Pre-launch waiting list, filled from the public landing page. Platform
-- data, not tenant data: rows exist before any company does, so no
-- company_id and no RLS — same standing as "companies" itself. The unique
-- email index makes a repeat signup an upsert-shaped no-op instead of a
-- duplicate row.
CREATE TABLE "waitlist_signups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company_name" text NOT NULL,
	"email" text NOT NULL,
	"mobile" text NOT NULL,
	"locale" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_signups_email_uq" ON "waitlist_signups" (lower("email"));
