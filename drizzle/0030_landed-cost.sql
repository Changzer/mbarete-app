ALTER TABLE "products" ADD COLUMN "hs_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "export_destination" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "import_duty_pct_br" numeric(7, 3);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "import_duty_pct_py" numeric(7, 3);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_export_destination_check" CHECK ("export_destination" IN ('', 'BR', 'PY'));--> statement-breakpoint
CREATE TABLE "shipping_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"destination" text NOT NULL,
	"mode" text DEFAULT 'lcl' NOT NULL,
	"basis" text DEFAULT 'per_cbm' NOT NULL,
	"amount" numeric(14, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"usable_cbm" numeric(8, 2) DEFAULT 68 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"effective_from" date NOT NULL,
	"created_by" integer,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "shipping_rates_destination_check" CHECK ("destination" IN ('BR', 'PY')),
	CONSTRAINT "shipping_rates_mode_check" CHECK ("mode" IN ('lcl', 'fcl')),
	CONSTRAINT "shipping_rates_basis_check" CHECK ("basis" IN ('per_cbm', 'per_40hq'))
);--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_company_created_by_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "users"("company_id","id");--> statement-breakpoint
CREATE INDEX "shipping_rates_company_dest_idx" ON "shipping_rates" USING btree ("company_id","destination","mode","effective_from");--> statement-breakpoint
ALTER TABLE "shipping_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shipping_rates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shipping_rates" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);
