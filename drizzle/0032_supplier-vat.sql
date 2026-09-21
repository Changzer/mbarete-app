-- The quote stays exclusive of supplier VAT; orders freeze the inclusive cost.
-- Zero leaves every existing product and offer unchanged. Historical order
-- prices are already frozen and must never be recalculated by this migration.
ALTER TABLE "products" ADD COLUMN "supplier_vat_pct" numeric(5,2) DEFAULT 0 NOT NULL
  CHECK ("supplier_vat_pct" BETWEEN 0 AND 100);
--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD COLUMN "supplier_vat_pct" numeric(5,2) DEFAULT 0 NOT NULL
  CHECK ("supplier_vat_pct" BETWEEN 0 AND 100);
