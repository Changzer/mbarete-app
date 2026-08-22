ALTER TABLE "exchange_rate_history" ALTER COLUMN "rate_to_usd" SET DATA TYPE numeric(18, 8);--> statement-breakpoint
ALTER TABLE "exchange_rates" ALTER COLUMN "rate_to_usd" SET DATA TYPE numeric(18, 8);--> statement-breakpoint
ALTER TABLE "order_expenses" ALTER COLUMN "amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "unit_price_snapshot" SET DATA TYPE numeric(14, 4);--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "sell_price_snapshot" SET DATA TYPE numeric(14, 4);--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "line_total" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "order_payments" ALTER COLUMN "amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "commission_pct" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "product_suppliers" ALTER COLUMN "price" SET DATA TYPE numeric(14, 4);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "price" SET DATA TYPE numeric(14, 4);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "sell_price" SET DATA TYPE numeric(14, 4);