CREATE TABLE "capture_visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"client_visit_id" text NOT NULL,
	"supplier_id" integer,
	"started_at" text NOT NULL,
	"created_by" integer,
	"decided_by" integer,
	"decided_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);--> statement-breakpoint
ALTER TABLE "capture_visits" ADD CONSTRAINT "capture_visits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capture_visits_company_client_uq" ON "capture_visits" USING btree ("company_id","client_visit_id");--> statement-breakpoint
ALTER TABLE "capture_visits" ADD CONSTRAINT "capture_visits_company_supplier_fk" FOREIGN KEY ("company_id","supplier_id") REFERENCES "contacts"("company_id","id");--> statement-breakpoint
ALTER TABLE "capture_visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "capture_visits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "capture_visits" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "capture_drafts" ADD COLUMN "visit_id" text;--> statement-breakpoint
ALTER TABLE "capture_drafts" ADD COLUMN "supplier_id" integer;--> statement-breakpoint
CREATE INDEX "capture_drafts_company_visit_idx" ON "capture_drafts" USING btree ("company_id","visit_id");--> statement-breakpoint
ALTER TABLE "capture_drafts" ADD CONSTRAINT "capture_drafts_company_supplier_fk" FOREIGN KEY ("company_id","supplier_id") REFERENCES "contacts"("company_id","id");--> statement-breakpoint
ALTER TABLE "capture_draft_images" ADD COLUMN "client_addendum_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "capture_draft_images_addendum_uq" ON "capture_draft_images" USING btree ("client_addendum_id");
