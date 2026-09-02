-- A company's own admin trail: every account change made from the Users
-- page (created, edited, password set, email changed, activated,
-- deactivated, role changed), with who made it. Tenant data: RLS like every
-- other table the company owns; no platform_read — the panel has its own
-- trail (platform_events) and does not read this one.
CREATE TABLE "admin_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"actor_user_id" integer NOT NULL,
	"action" text NOT NULL,
	"target_user_id" integer,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);--> statement-breakpoint
CREATE INDEX "admin_events_company_idx" ON "admin_events" USING btree ("company_id","id");--> statement-breakpoint
ALTER TABLE "admin_events" ADD CONSTRAINT "admin_events_company_actor_fk" FOREIGN KEY ("company_id","actor_user_id") REFERENCES "users"("company_id","id");--> statement-breakpoint
ALTER TABLE "admin_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "admin_events" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);
