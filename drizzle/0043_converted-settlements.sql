ALTER TABLE "order_payments" ADD COLUMN "channel" text DEFAULT 'bank' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_payments" ADD COLUMN "settlement_amount" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "order_payments" ADD COLUMN "settlement_currency" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_payments" ADD COLUMN "settlement_account_id" integer;--> statement-breakpoint
ALTER TABLE "order_payments" ADD COLUMN "effective_rate" numeric(18, 8);--> statement-breakpoint
ALTER TABLE "order_payments" ADD COLUMN "conversion_cost" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "order_payments" ADD COLUMN "inbound_receipt_path" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_payments" ADD COLUMN "inbound_receipt_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_payments" ADD COLUMN "outbound_receipt_path" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_payments" ADD COLUMN "outbound_receipt_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_company_settlement_account_fk" FOREIGN KEY ("company_id","settlement_account_id") REFERENCES "public"."bank_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;
