ALTER TABLE "capture_drafts" DROP CONSTRAINT "capture_drafts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "capture_drafts" DROP CONSTRAINT "capture_drafts_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "entity_events" DROP CONSTRAINT "entity_events_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_client_id_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_bank_account_id_bank_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "product_suppliers" DROP CONSTRAINT "product_suppliers_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "product_suppliers" DROP CONSTRAINT "product_suppliers_supplier_id_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_category_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_supplier_id_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD COLUMN "company_id" integer;
--> statement-breakpoint
UPDATE "product_suppliers" SET "company_id" = p."company_id" FROM "products" p WHERE p."id" = "product_suppliers"."product_id";
--> statement-breakpoint
ALTER TABLE "product_suppliers" ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_company_id_uq" ON "bank_accounts" USING btree ("company_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "categories_company_id_uq" ON "categories" USING btree ("company_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_company_id_uq" ON "contacts" USING btree ("company_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "orders_company_id_uq" ON "orders" USING btree ("company_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "products_company_id_uq" ON "products" USING btree ("company_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "users_company_id_uq" ON "users" USING btree ("company_id","id");
--> statement-breakpoint
ALTER TABLE "capture_drafts" ADD CONSTRAINT "capture_drafts_company_user_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "capture_drafts" ADD CONSTRAINT "capture_drafts_company_product_fk" FOREIGN KEY ("company_id","product_id") REFERENCES "public"."products"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "entity_events" ADD CONSTRAINT "entity_events_company_user_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_client_fk" FOREIGN KEY ("company_id","client_id") REFERENCES "public"."contacts"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_bank_fk" FOREIGN KEY ("company_id","bank_account_id") REFERENCES "public"."bank_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_company_product_fk" FOREIGN KEY ("company_id","product_id") REFERENCES "public"."products"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_company_supplier_fk" FOREIGN KEY ("company_id","supplier_id") REFERENCES "public"."contacts"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_category_fk" FOREIGN KEY ("company_id","category_id") REFERENCES "public"."categories"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_supplier_fk" FOREIGN KEY ("company_id","supplier_id") REFERENCES "public"."contacts"("company_id","id") ON DELETE no action ON UPDATE no action;
