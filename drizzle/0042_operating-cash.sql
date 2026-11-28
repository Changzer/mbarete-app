ALTER TABLE "bank_accounts" ADD COLUMN "opening_balance" numeric(18, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "opening_date" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "track_balance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "operating_expenses" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL,
  "category" text NOT NULL,
  "amount" numeric(18, 4) NOT NULL,
  "currency" text NOT NULL,
  "spent_on" date NOT NULL,
  "account_id" integer NOT NULL,
  "vendor" text DEFAULT '' NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "receipt_path" text DEFAULT '' NOT NULL,
  "receipt_name" text DEFAULT '' NOT NULL,
  "created_by" integer,
  "created_at" text DEFAULT (to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "operating_expenses_company_id_uq" ON "operating_expenses" USING btree ("company_id","id");--> statement-breakpoint
CREATE INDEX "operating_expenses_company_date_idx" ON "operating_expenses" USING btree ("company_id","spent_on");--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_company_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."bank_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_company_creator_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "operating_expenses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "operating_expenses" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
CREATE TABLE "cash_transactions" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL,
  "kind" text NOT NULL,
  "direction" text DEFAULT 'in' NOT NULL,
  "amount" numeric(18, 4) NOT NULL,
  "currency" text NOT NULL,
  "transacted_on" date NOT NULL,
  "account_id" integer NOT NULL,
  "destination_account_id" integer,
  "counterparty" text DEFAULT '' NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "created_by" integer,
  "created_at" text DEFAULT (to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')) NOT NULL,
  CONSTRAINT "cash_transactions_kind_check" CHECK (kind IN ('other_income','transfer','adjustment')),
  CONSTRAINT "cash_transactions_direction_check" CHECK (direction IN ('in','out'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "cash_transactions_company_id_uq" ON "cash_transactions" USING btree ("company_id","id");--> statement-breakpoint
CREATE INDEX "cash_transactions_company_date_idx" ON "cash_transactions" USING btree ("company_id","transacted_on");--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_company_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."bank_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_company_destination_fk" FOREIGN KEY ("company_id","destination_account_id") REFERENCES "public"."bank_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_company_creator_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_transactions" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
CREATE TABLE "cash_balance_checks" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL,
  "account_id" integer NOT NULL,
  "amount" numeric(18, 4) NOT NULL,
  "checked_on" date NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "created_by" integer,
  "created_at" text DEFAULT (to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "cash_balance_checks_company_id_uq" ON "cash_balance_checks" USING btree ("company_id","id");--> statement-breakpoint
CREATE INDEX "cash_balance_checks_company_account_date_idx" ON "cash_balance_checks" USING btree ("company_id","account_id","checked_on");--> statement-breakpoint
ALTER TABLE "cash_balance_checks" ADD CONSTRAINT "cash_balance_checks_company_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."bank_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_balance_checks" ADD CONSTRAINT "cash_balance_checks_company_creator_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_balance_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_balance_checks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_balance_checks" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);
