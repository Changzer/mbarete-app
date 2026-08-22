ALTER TABLE "capture_draft_images" DROP CONSTRAINT "capture_draft_images_draft_id_capture_drafts_id_fk";
--> statement-breakpoint
ALTER TABLE "contact_images" DROP CONSTRAINT "contact_images_contact_id_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "order_documents" DROP CONSTRAINT "order_documents_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "order_documents" DROP CONSTRAINT "order_documents_uploaded_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "order_events" DROP CONSTRAINT "order_events_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "order_events" DROP CONSTRAINT "order_events_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "order_expenses" DROP CONSTRAINT "order_expenses_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "order_expenses" DROP CONSTRAINT "order_expenses_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "order_payments" DROP CONSTRAINT "order_payments_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "order_payments" DROP CONSTRAINT "order_payments_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "product_images" DROP CONSTRAINT "product_images_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "company_id" integer;
--> statement-breakpoint
UPDATE "order_items" SET "company_id" = p."company_id" FROM "orders" p WHERE p."id" = "order_items"."order_id";
--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "company_id" integer;
--> statement-breakpoint
UPDATE "product_images" SET "company_id" = p."company_id" FROM "products" p WHERE p."id" = "product_images"."product_id";
--> statement-breakpoint
ALTER TABLE "product_images" ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "contact_images" ADD COLUMN "company_id" integer;
--> statement-breakpoint
UPDATE "contact_images" SET "company_id" = p."company_id" FROM "contacts" p WHERE p."id" = "contact_images"."contact_id";
--> statement-breakpoint
ALTER TABLE "contact_images" ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_documents" ADD COLUMN "company_id" integer;
--> statement-breakpoint
UPDATE "order_documents" SET "company_id" = p."company_id" FROM "orders" p WHERE p."id" = "order_documents"."order_id";
--> statement-breakpoint
ALTER TABLE "order_documents" ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_payments" ADD COLUMN "company_id" integer;
--> statement-breakpoint
UPDATE "order_payments" SET "company_id" = p."company_id" FROM "orders" p WHERE p."id" = "order_payments"."order_id";
--> statement-breakpoint
ALTER TABLE "order_payments" ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_expenses" ADD COLUMN "company_id" integer;
--> statement-breakpoint
UPDATE "order_expenses" SET "company_id" = p."company_id" FROM "orders" p WHERE p."id" = "order_expenses"."order_id";
--> statement-breakpoint
ALTER TABLE "order_expenses" ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_events" ADD COLUMN "company_id" integer;
--> statement-breakpoint
UPDATE "order_events" SET "company_id" = p."company_id" FROM "orders" p WHERE p."id" = "order_events"."order_id";
--> statement-breakpoint
ALTER TABLE "order_events" ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "capture_draft_images" ADD COLUMN "company_id" integer;
--> statement-breakpoint
UPDATE "capture_draft_images" SET "company_id" = p."company_id" FROM "capture_drafts" p WHERE p."id" = "capture_draft_images"."draft_id";
--> statement-breakpoint
ALTER TABLE "capture_draft_images" ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "capture_drafts_company_id_uq" ON "capture_drafts" USING btree ("company_id","id");
--> statement-breakpoint
ALTER TABLE "capture_draft_images" ADD CONSTRAINT "capture_draft_images_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "capture_draft_images" ADD CONSTRAINT "capture_draft_images_company_draft_fk" FOREIGN KEY ("company_id","draft_id") REFERENCES "public"."capture_drafts"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contact_images" ADD CONSTRAINT "contact_images_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contact_images" ADD CONSTRAINT "contact_images_company_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."contacts"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_documents" ADD CONSTRAINT "order_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_documents" ADD CONSTRAINT "order_documents_company_order_fk" FOREIGN KEY ("company_id","order_id") REFERENCES "public"."orders"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_documents" ADD CONSTRAINT "order_documents_company_uploaded_by_fk" FOREIGN KEY ("company_id","uploaded_by") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_company_order_fk" FOREIGN KEY ("company_id","order_id") REFERENCES "public"."orders"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_company_user_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_expenses" ADD CONSTRAINT "order_expenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_expenses" ADD CONSTRAINT "order_expenses_company_order_fk" FOREIGN KEY ("company_id","order_id") REFERENCES "public"."orders"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_expenses" ADD CONSTRAINT "order_expenses_company_created_by_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_company_order_fk" FOREIGN KEY ("company_id","order_id") REFERENCES "public"."orders"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_company_product_fk" FOREIGN KEY ("company_id","product_id") REFERENCES "public"."products"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_company_order_fk" FOREIGN KEY ("company_id","order_id") REFERENCES "public"."orders"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_company_created_by_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_company_product_fk" FOREIGN KEY ("company_id","product_id") REFERENCES "public"."products"("company_id","id") ON DELETE cascade ON UPDATE no action;
