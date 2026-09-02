-- The operator's audit trail: every cross-tenant write from the platform
-- panel and every reset link minted there. Platform data, like "companies":
-- the operator acts across tenants by definition, so no company_id and no
-- RLS. The panel reads it back under platform scope; tenants never see it.
CREATE TABLE "platform_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"operator_user_id" integer NOT NULL,
	"action" text NOT NULL,
	"target_company_id" integer,
	"target_user_id" integer,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);--> statement-breakpoint
ALTER TABLE "platform_events" ADD CONSTRAINT "platform_events_operator_user_id_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_events_created_idx" ON "platform_events" USING btree ("created_at");
