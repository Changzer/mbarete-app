-- Supplier provenance belongs to the order, not to the mutable catalog.
-- No FK: a supplier's deletion must not erase its historical identity.
-- Old rows remain explicitly unknown; today's supplier is not historical proof.
ALTER TABLE order_items ADD COLUMN supplier_id_snapshot integer;
--> statement-breakpoint
ALTER TABLE order_items ADD COLUMN supplier_name_en_snapshot text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE order_items ADD COLUMN supplier_name_zh_snapshot text NOT NULL DEFAULT '';
