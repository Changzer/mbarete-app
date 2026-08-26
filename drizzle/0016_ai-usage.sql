-- One row per AI scan: who spent what on which provider. The testing
-- phase's pricing question — "what does a tenant's AI habit cost?" — is
-- answerable only if the spend is written down when it happens.
CREATE TABLE "ai_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"user_id" integer,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"images" integer NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);--> statement-breakpoint
CREATE INDEX "ai_usage_company_idx" ON "ai_usage" ("company_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_usage" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
CREATE POLICY "platform_read" ON "ai_usage" AS PERMISSIVE FOR SELECT TO PUBLIC USING (current_setting('app.platform', true) = '1');
