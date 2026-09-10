ALTER TABLE "orders" ADD COLUMN "tax_regime" text DEFAULT 'undecided' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customs_declaration_no" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "export_contract_date" date;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "purchase_contract_date" date;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "warehouse_in_date" date;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "export_date" date;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tax_regime_check" CHECK ("tax_regime" IN ('undecided', 'rebate', 'exempt'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customs_declaration_no_check" CHECK ("customs_declaration_no" IS NULL OR "customs_declaration_no" ~ '^[0-9]{18}$');--> statement-breakpoint
ALTER TABLE "order_documents" ADD COLUMN "fapiao_type" text;--> statement-breakpoint
ALTER TABLE "order_documents" ADD CONSTRAINT "order_documents_fapiao_type_check" CHECK ("fapiao_type" IS NULL OR "fapiao_type" IN ('special', 'special_3', 'ordinary_exempt', 'none'));--> statement-breakpoint
ALTER TABLE "order_documents" ADD CONSTRAINT "order_documents_kind_check" CHECK ("kind" IN ('supplier_invoice', 'packing_list', 'bill_of_lading', 'inspection', 'other', 'customs_declaration', 'customs_agency_agreement', 'release_notice', 'export_invoice', 'proforma', 'export_contract', 'purchase_contract', 'domestic_freight_invoice', 'intl_freight_invoice', 'freight_breakdown', 'fx_settlement_slip', 'freight_payment_slip', 'factory_payment_slip', 'warehouse_slip', 'trade_correspondence', 'loading_video'));
