CREATE TABLE "followup_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"order_id" integer NOT NULL,
	"kind" text NOT NULL,
	"supplier_id" integer,
	"stage" text DEFAULT 'deposit' NOT NULL,
	"next_step" text DEFAULT '' NOT NULL,
	"next_due" text,
	"next_owner_id" integer,
	"problem" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_by" integer,
	CONSTRAINT "followup_cards_kind_check" CHECK ("kind" IN ('supplier', 'unassigned', 'shipment')),
	CONSTRAINT "followup_cards_supplier_check" CHECK (("kind" = 'supplier') = ("supplier_id" IS NOT NULL)),
	CONSTRAINT "followup_cards_stage_check" CHECK ("stage" IN ('deposit', 'production', 'qc', 'to_warehouse', 'at_warehouse')),
	CONSTRAINT "followup_cards_due_check" CHECK ("next_due" IS NULL OR "next_due" ~ '^\d{4}-\d{2}-\d{2}$')
);--> statement-breakpoint
ALTER TABLE "followup_cards" ADD CONSTRAINT "followup_cards_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_cards" ADD CONSTRAINT "followup_cards_company_order_fk" FOREIGN KEY ("company_id","order_id") REFERENCES "public"."orders"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_cards" ADD CONSTRAINT "followup_cards_company_owner_fk" FOREIGN KEY ("company_id","next_owner_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "followup_cards_company_id_uq" ON "followup_cards" USING btree ("company_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "followup_cards_order_uq" ON "followup_cards" USING btree ("order_id","kind",COALESCE("supplier_id", 0));--> statement-breakpoint
CREATE INDEX "followup_cards_company_idx" ON "followup_cards" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "followup_cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "followup_cards" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "followup_cards" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
CREATE TABLE "followup_checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"card_id" integer NOT NULL,
	"text" text NOT NULL,
	"owner_id" integer,
	"done" boolean DEFAULT false NOT NULL,
	"done_by" integer,
	"done_at" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);--> statement-breakpoint
ALTER TABLE "followup_checklist_items" ADD CONSTRAINT "followup_checklist_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_checklist_items" ADD CONSTRAINT "followup_checklist_items_company_card_fk" FOREIGN KEY ("company_id","card_id") REFERENCES "public"."followup_cards"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_checklist_items" ADD CONSTRAINT "followup_checklist_items_company_owner_fk" FOREIGN KEY ("company_id","owner_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "followup_checklist_items_card_idx" ON "followup_checklist_items" USING btree ("card_id");--> statement-breakpoint
ALTER TABLE "followup_checklist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "followup_checklist_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "followup_checklist_items" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
CREATE TABLE "followup_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"card_id" integer NOT NULL,
	"user_id" integer,
	"kind" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"payload" text DEFAULT '{}' NOT NULL,
	"client_key" text,
	"removed_at" text,
	"removed_by" integer,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "followup_entries_kind_check" CHECK ("kind" IN ('comment', 'stage', 'next_step', 'problem', 'check_added', 'check_done', 'check_undone', 'check_removed'))
);--> statement-breakpoint
ALTER TABLE "followup_entries" ADD CONSTRAINT "followup_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_entries" ADD CONSTRAINT "followup_entries_company_card_fk" FOREIGN KEY ("company_id","card_id") REFERENCES "public"."followup_cards"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_entries" ADD CONSTRAINT "followup_entries_company_user_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "followup_entries_company_id_uq" ON "followup_entries" USING btree ("company_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "followup_entries_client_key_uq" ON "followup_entries" USING btree ("company_id","client_key");--> statement-breakpoint
CREATE INDEX "followup_entries_card_idx" ON "followup_entries" USING btree ("card_id","id");--> statement-breakpoint
ALTER TABLE "followup_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "followup_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "followup_entries" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
CREATE TABLE "followup_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"entry_id" integer NOT NULL,
	"path" text NOT NULL,
	"original_name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);--> statement-breakpoint
ALTER TABLE "followup_attachments" ADD CONSTRAINT "followup_attachments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_attachments" ADD CONSTRAINT "followup_attachments_company_entry_fk" FOREIGN KEY ("company_id","entry_id") REFERENCES "public"."followup_entries"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "followup_attachments_entry_idx" ON "followup_attachments" USING btree ("entry_id");--> statement-breakpoint
ALTER TABLE "followup_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "followup_attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "followup_attachments" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);
