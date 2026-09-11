-- Enquiries from the public services page. Platform data, not tenant data:
-- a row exists before any company does, so no company_id and no RLS — the
-- same standing as "companies" and "waitlist_signups".
--
-- Deliberately NOT a second waiting list, and deliberately NOT unique on
-- email. "waitlist_signups" is unique on lower(email) and swallows the
-- duplicate as success, which is right when the question is "am I on the
-- list?" and wrong here: an importer who asks about phone cases in March and
-- hammocks in June has sent two enquiries, and silently dropping the second
-- would lose a live sale. Every row is its own conversation.
--
-- waitlist_signups stays as it is. It holds real pre-launch signups from the
-- SaaS period and dropping the table would throw them away.
CREATE TABLE "service_enquiries" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company_name" text NOT NULL,
	"email" text NOT NULL,
	"preferred_contact" text,
	"message" text NOT NULL,
	"locale" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);--> statement-breakpoint
-- The operator panel reads newest first and nothing else queries this table.
CREATE INDEX "service_enquiries_created_idx" ON "service_enquiries" ("created_at" DESC);
