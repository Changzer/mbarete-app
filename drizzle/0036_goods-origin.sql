-- Where a supplier is — province and city — which is where an export
-- declaration says their goods come from (境内货源地). Suppliers met at
-- Yiwu's markets start as Yiwu: customs takes the place of the earliest
-- purchase when the factory is elsewhere and unknown, and a person corrects
-- the ones whose card or factory says otherwise.
ALTER TABLE "contacts" ADD COLUMN "province" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "city" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "contacts" SET "province" = '浙江省', "city" = '义乌市'
WHERE "type" = 'supplier' AND "province" = '' AND "city" = '' AND "booth_location" ~* '(义乌|yiwu)';--> statement-breakpoint
-- The marks printed on the cartons and on every customs sheet (唛头).
ALTER TABLE "orders" ADD COLUMN "shipping_marks" text DEFAULT '' NOT NULL;
