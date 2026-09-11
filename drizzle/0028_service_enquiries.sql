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
-- quantity, destination and target_price are free text on purpose. Importers
-- state quantity in whatever unit their trade uses ("500 pcs", "1x40HQ"), a
-- destination may be a country or a named port, and a target price carries
-- its own currency. Parsing any of it into columns would reject more real
-- enquiries than it would tidy up; the operator reads them, not a query.
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
	"quantity" text,
	"destination" text,
	"target_price" text,
	"locale" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);--> statement-breakpoint
-- The operator panel reads newest first and nothing else queries this table.
CREATE INDEX "service_enquiries_created_idx" ON "service_enquiries" ("created_at" DESC);--> statement-breakpoint

-- Photos a buyer attached to show us the product. A child table rather than an
-- array column, matching capture_draft_images: the same shape the rest of the
-- schema already uses for "several files belong to this row".
--
-- The path always points at an "enq-" prefixed file, which the serving route
-- releases only to the platform operator. These come from strangers with no
-- account, so they must never sit on the open image path.
CREATE TABLE "service_enquiry_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"enquiry_id" integer NOT NULL REFERENCES "service_enquiries"("id") ON DELETE CASCADE,
	"path" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);--> statement-breakpoint
CREATE INDEX "service_enquiry_images_enquiry_idx" ON "service_enquiry_images" ("enquiry_id");
