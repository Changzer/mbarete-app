-- Pre-launch waiting list, filled from the public landing page. Platform
-- data, not tenant data: rows exist before any company does, so no
-- company_id and no RLS — same standing as "companies" itself. The unique
-- email index makes a repeat signup an upsert-shaped no-op instead of a
-- duplicate row.
--
-- preferred_contact is free text and nullable on purpose: the page is aimed at
-- import teams outside China as much as buyers inside it, so a WeChat ID, a
-- WhatsApp number and an international phone number all have to fit, and none
-- of them may be demanded before someone will leave an email.
CREATE TABLE "waitlist_signups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company_name" text NOT NULL,
	"email" text NOT NULL,
	"preferred_contact" text,
	"locale" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_signups_email_uq" ON "waitlist_signups" (lower("email"));
