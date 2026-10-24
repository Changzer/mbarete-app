ALTER TABLE "users" ADD COLUMN "kind" text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_kind_check" CHECK ("kind" IN ('person', 'assistant'));--> statement-breakpoint
-- An assistant is never an admin and never the platform operator, whatever
-- an action or a hand-run UPDATE later tries.
ALTER TABLE "users" ADD CONSTRAINT "users_assistant_check" CHECK ("kind" = 'person' OR ("role" = 'collaborator' AND "platform_admin" = false));--> statement-breakpoint
CREATE TABLE "assistant_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"key_issued_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"last_used_at" text,
	CONSTRAINT "assistant_keys_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
ALTER TABLE "assistant_keys" ADD CONSTRAINT "assistant_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_keys" ADD CONSTRAINT "assistant_keys_company_user_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_keys" ADD CONSTRAINT "assistant_keys_company_creator_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_keys_user_uq" ON "assistant_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "assistant_keys_company_idx" ON "assistant_keys" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "assistant_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assistant_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "assistant_keys" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);
