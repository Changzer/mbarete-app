-- The platform operator's view of the SaaS: module switches per company, a
-- hidden-panel flag on users, and a per-user-per-day activity ledger.
--
-- The "platform_read" policies are the deliberate, narrow door through the
-- tenant walls: SELECT-only, open only when the connection carries
-- app.platform = '1', which only the panel's own loader sets (and only after
-- users.platform_admin passed). Policies are PERMISSIVE, so these OR with
-- tenant_isolation without loosening it: a request with a tenant and no
-- platform flag behaves exactly as before, and platform scope can read
-- everything but write nothing — tenant_isolation's WITH CHECK still guards
-- every write and never matches a connection with no tenant.
ALTER TABLE "companies" ADD COLUMN "module_orders" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "module_finance" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "user_activity_days" (
	"company_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"day" text NOT NULL,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_activity_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);--> statement-breakpoint
ALTER TABLE "user_activity_days" ADD CONSTRAINT "user_activity_days_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_activity_days" ADD CONSTRAINT "user_activity_company_user_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_activity_company_idx" ON "user_activity_days" ("company_id");--> statement-breakpoint
ALTER TABLE "user_activity_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_activity_days" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "user_activity_days" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
CREATE POLICY "platform_read" ON "user_activity_days" AS PERMISSIVE FOR SELECT TO PUBLIC USING (current_setting('app.platform', true) = '1');--> statement-breakpoint
CREATE POLICY "platform_read" ON "products" AS PERMISSIVE FOR SELECT TO PUBLIC USING (current_setting('app.platform', true) = '1');--> statement-breakpoint
CREATE POLICY "platform_read" ON "orders" AS PERMISSIVE FOR SELECT TO PUBLIC USING (current_setting('app.platform', true) = '1');--> statement-breakpoint
CREATE POLICY "platform_read" ON "contacts" AS PERMISSIVE FOR SELECT TO PUBLIC USING (current_setting('app.platform', true) = '1');
