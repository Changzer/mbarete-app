-- Outgoing money can belong to one supplier on a mixed order. Null remains
-- deliberately unassigned: historical multi-supplier payments must not guess.
ALTER TABLE "order_payments" ADD COLUMN "supplier_id" integer;--> statement-breakpoint
CREATE INDEX "order_payments_supplier_idx" ON "order_payments" ("company_id","order_id","supplier_id");--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_company_supplier_fk" FOREIGN KEY ("company_id","supplier_id") REFERENCES "public"."contacts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Only the unambiguous historical case is safe to backfill: one supplier on
-- every line, with no unknown-supplier line hiding beside it.
WITH eligible AS (
  SELECT order_id, MIN(supplier_id_snapshot) AS supplier_id
  FROM order_items
  GROUP BY order_id
  HAVING COUNT(DISTINCT supplier_id_snapshot) = 1
    AND COUNT(*) FILTER (WHERE supplier_id_snapshot IS NULL) = 0
)
UPDATE order_payments AS p
SET supplier_id = e.supplier_id
FROM eligible AS e
WHERE p.order_id = e.order_id AND p.direction = 'out' AND p.supplier_id IS NULL;
