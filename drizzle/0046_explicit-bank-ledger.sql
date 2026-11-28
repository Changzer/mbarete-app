CREATE TABLE "bank_statement_documents" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL REFERENCES "companies"("id"),
  "account_id" integer NOT NULL,
  "path" text NOT NULL,
  "original_name" text NOT NULL,
  "sha256" text NOT NULL,
  "created_by" integer,
  "created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statement_documents_company_id_uq" ON "bank_statement_documents" ("company_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statement_documents_company_account_sha_uq" ON "bank_statement_documents" ("company_id", "account_id", "sha256");
--> statement-breakpoint
CREATE INDEX "bank_statement_documents_company_account_idx" ON "bank_statement_documents" ("company_id", "account_id");
--> statement-breakpoint
ALTER TABLE "bank_statement_documents" ADD CONSTRAINT "bank_statement_documents_company_account_fk" FOREIGN KEY ("company_id", "account_id") REFERENCES "bank_accounts"("company_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_documents" ADD CONSTRAINT "bank_statement_documents_company_creator_fk" FOREIGN KEY ("company_id", "created_by") REFERENCES "users"("company_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bank_statement_documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bank_statement_documents" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);
--> statement-breakpoint
ALTER TABLE "order_payments"
  ADD COLUMN "cash_account_id" integer,
  ADD COLUMN "bank_reference" text DEFAULT '' NOT NULL,
  ADD COLUMN "statement_document_id" integer,
  ADD COLUMN "statement_row" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_company_cash_account_fk" FOREIGN KEY ("company_id", "cash_account_id") REFERENCES "bank_accounts"("company_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_company_statement_fk" FOREIGN KEY ("company_id", "statement_document_id") REFERENCES "bank_statement_documents"("company_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "order_payments_statement_row_uq" ON "order_payments" ("company_id", "statement_document_id", "statement_row") WHERE "statement_document_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "order_payments_company_cash_account_idx" ON "order_payments" ("company_id", "cash_account_id");
--> statement-breakpoint
ALTER TABLE "order_expenses"
  ADD COLUMN "account_id" integer,
  ADD COLUMN "bank_reference" text DEFAULT '' NOT NULL,
  ADD COLUMN "statement_document_id" integer,
  ADD COLUMN "statement_row" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_expenses" ADD CONSTRAINT "order_expenses_company_account_fk" FOREIGN KEY ("company_id", "account_id") REFERENCES "bank_accounts"("company_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_expenses" ADD CONSTRAINT "order_expenses_company_statement_fk" FOREIGN KEY ("company_id", "statement_document_id") REFERENCES "bank_statement_documents"("company_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "order_expenses_statement_row_uq" ON "order_expenses" ("company_id", "statement_document_id", "statement_row") WHERE "statement_document_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "operating_expenses"
  ADD COLUMN "bank_reference" text DEFAULT '' NOT NULL,
  ADD COLUMN "statement_document_id" integer,
  ADD COLUMN "statement_row" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_company_statement_fk" FOREIGN KEY ("company_id", "statement_document_id") REFERENCES "bank_statement_documents"("company_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "operating_expenses_statement_row_uq" ON "operating_expenses" ("company_id", "statement_document_id", "statement_row") WHERE "statement_document_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "cash_transactions"
  ADD COLUMN "destination_amount" numeric(18, 4),
  ADD COLUMN "destination_currency" text DEFAULT '' NOT NULL,
  ADD COLUMN "receipt_path" text DEFAULT '' NOT NULL,
  ADD COLUMN "receipt_name" text DEFAULT '' NOT NULL,
  ADD COLUMN "bank_reference" text DEFAULT '' NOT NULL,
  ADD COLUMN "statement_document_id" integer,
  ADD COLUMN "statement_row" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_company_statement_fk" FOREIGN KEY ("company_id", "statement_document_id") REFERENCES "bank_statement_documents"("company_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "cash_transactions_statement_row_uq" ON "cash_transactions" ("company_id", "statement_document_id", "statement_row") WHERE "statement_document_id" IS NOT NULL;
