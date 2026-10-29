-- The factory's figures for a line, entered on the order once it is packed:
-- an Update-from-catalog then leaves the line's packing alone.
ALTER TABLE "order_items" ADD COLUMN "packing_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- What the carton labels carry besides the marks: the forwarder's warehouse
-- in China the goods are delivered to, and the final consignee ("" = the
-- client's own details). The 报关件 stamp only belongs on goods declared
-- under the exporter's own name.
ALTER TABLE "orders" ADD COLUMN "label_warehouse" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "label_consignee" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "label_customs_stamp" boolean DEFAULT true NOT NULL;
