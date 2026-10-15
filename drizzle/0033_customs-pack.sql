-- What a Chinese export declaration asks for that the app did not hold.
-- Products: China's own 10-digit export code (the Mercosur NCM is the
-- destination's), the declaration elements (申报要素) the broker files with
-- it, and the unit the quantity is declared in. Orders: where the goods
-- leave from and go to, and where in China they were made. Every column
-- defaults empty, so existing rows read as "not recorded yet".
ALTER TABLE "products" ADD COLUMN "cn_hs_code" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "declaration_elements" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "customs_unit" text DEFAULT 'pcs' NOT NULL
  CHECK ("customs_unit" IN ('pcs', 'set', 'pair'));
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "port_of_loading" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "port_of_destination" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "destination_country" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "goods_origin" text DEFAULT '' NOT NULL;
