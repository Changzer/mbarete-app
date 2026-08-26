-- Period close = the accountant pack's tamper-evidence anchor. Closing a
-- period records a deterministic digest of its data; it never locks the
-- data — operational software must not hold records hostage — it only
-- makes after-the-fact changes visible on the next pack.
CREATE TABLE "period_closes" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL REFERENCES "companies"("id"),
	"period" text NOT NULL,
	"closed_by" integer,
	"closed_at" text NOT NULL,
	"pack_sha256" text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "period_closes_company_period_uq" ON "period_closes" ("company_id","period");--> statement-breakpoint
ALTER TABLE "period_closes" ADD CONSTRAINT "period_closes_company_closed_by_fk" FOREIGN KEY ("company_id","closed_by") REFERENCES "users"("company_id","id");--> statement-breakpoint
ALTER TABLE "period_closes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "period_closes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "period_closes" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);
