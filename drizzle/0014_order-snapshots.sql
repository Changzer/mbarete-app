-- Order lines become fully self-describing, so an ordinary edit never needs
-- (and never gets) the live catalog: identity for the documents, the carton
-- inputs for recomputing logistics on a quantity change, and the sell price's
-- own currency so a catalog cost-currency change can never relabel a quote.
ALTER TABLE "order_items" ADD COLUMN "sku_snapshot" text NOT NULL DEFAULT '';
ALTER TABLE "order_items" ADD COLUMN "name_en_snapshot" text NOT NULL DEFAULT '';
ALTER TABLE "order_items" ADD COLUMN "name_zh_snapshot" text NOT NULL DEFAULT '';
ALTER TABLE "order_items" ADD COLUMN "supplier_code_snapshot" text NOT NULL DEFAULT '';
ALTER TABLE "order_items" ADD COLUMN "qty_per_box_snapshot" integer NOT NULL DEFAULT 0;
ALTER TABLE "order_items" ADD COLUMN "carton_cbm_snapshot" double precision NOT NULL DEFAULT 0;
ALTER TABLE "order_items" ADD COLUMN "carton_weight_snapshot" double precision NOT NULL DEFAULT 0;
ALTER TABLE "order_items" ADD COLUMN "sell_currency_snapshot" text NOT NULL DEFAULT '';
--> statement-breakpoint
-- Optimistic concurrency: every mutation carries the version it saw and the
-- write refuses when the row moved. Confirm-time freeze of the parties: the
-- client, seller and bank block a confirmed document prints, immune to later
-- master-data edits. NULL = not frozen (drafts, and never-confirmed orders).
ALTER TABLE "orders" ADD COLUMN "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "orders" ADD COLUMN "parties_snapshot" text;
--> statement-breakpoint
-- Backfill from the live catalog — the closest honest interpretation for
-- rows that never stored these facts. Lines whose product is gone keep the
-- defaults and readers fall back exactly as they did before this migration.
UPDATE "order_items" oi SET
  "sku_snapshot" = COALESCE(p."sku", ''),
  "name_en_snapshot" = COALESCE(p."name_en", ''),
  "name_zh_snapshot" = COALESCE(p."name_zh", ''),
  "supplier_code_snapshot" = COALESCE(p."supplier_code", ''),
  "qty_per_box_snapshot" = COALESCE(p."qty_per_box", 0),
  "carton_cbm_snapshot" = COALESCE(p."cbm", 0),
  "carton_weight_snapshot" = COALESCE(p."weight_kg", 0)
FROM "products" p WHERE p."id" = oi."product_id" AND p."company_id" = oi."company_id";
--> statement-breakpoint
-- The sell price has always been interpreted in the line's cost currency;
-- writing that down is a rename, not a change.
UPDATE "order_items" SET "sell_currency_snapshot" = "currency_snapshot" WHERE "sell_currency_snapshot" = '';
