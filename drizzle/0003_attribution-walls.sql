ALTER TABLE "orders" DROP CONSTRAINT "orders_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_updated_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "product_suppliers" DROP CONSTRAINT "product_suppliers_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_updated_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_created_by_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_updated_by_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_company_created_by_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_created_by_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_updated_by_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;