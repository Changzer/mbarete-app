CREATE TABLE "bank_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"label" text NOT NULL,
	"bank_name" text DEFAULT '' NOT NULL,
	"account_name" text DEFAULT '' NOT NULL,
	"account_number" text DEFAULT '' NOT NULL,
	"swift" text DEFAULT '' NOT NULL,
	"bank_address" text DEFAULT '' NOT NULL,
	"currency" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capture_draft_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer NOT NULL,
	"role" text DEFAULT 'image' NOT NULL,
	"path" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capture_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"client_id" text NOT NULL,
	"user_id" integer,
	"kind" text DEFAULT 'product' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"fields" text DEFAULT '{}' NOT NULL,
	"transcript" text DEFAULT '{}' NOT NULL,
	"transcript_notes" text DEFAULT '' NOT NULL,
	"transcript_error" text DEFAULT '' NOT NULL,
	"product_id" integer,
	"captured_at" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "capture_drafts_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name_en" text NOT NULL,
	"name_zh" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" integer,
	"plan" text DEFAULT 'free' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_profile" (
	"company_id" integer PRIMARY KEY NOT NULL,
	"company_name" text DEFAULT '' NOT NULL,
	"address_lines" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"tax_id" text DEFAULT '' NOT NULL,
	"bank_name" text DEFAULT '' NOT NULL,
	"bank_account_name" text DEFAULT '' NOT NULL,
	"bank_account_number" text DEFAULT '' NOT NULL,
	"bank_swift" text DEFAULT '' NOT NULL,
	"bank_address" text DEFAULT '' NOT NULL,
	"payment_terms" text DEFAULT '' NOT NULL,
	"incoterms" text DEFAULT '' NOT NULL,
	"validity_days" integer DEFAULT 30 NOT NULL,
	"footer_note" text DEFAULT '' NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"kind" text DEFAULT 'card' NOT NULL,
	"path" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"type" text NOT NULL,
	"company_name" text NOT NULL,
	"company_name_zh" text DEFAULT '' NOT NULL,
	"contact_person" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"whatsapp" text DEFAULT '' NOT NULL,
	"wechat" text DEFAULT '' NOT NULL,
	"booth_location" text DEFAULT '' NOT NULL,
	"bank_info" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"entity" text NOT NULL,
	"entity_id" integer NOT NULL,
	"user_id" integer,
	"kind" text NOT NULL,
	"payload" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rate_history" (
	"company_id" integer NOT NULL,
	"day" text NOT NULL,
	"currency_code" text NOT NULL,
	"rate_to_usd" double precision NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	CONSTRAINT "exchange_rate_history_company_id_day_currency_code_pk" PRIMARY KEY("company_id","day","currency_code")
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"company_id" integer NOT NULL,
	"currency_code" text NOT NULL,
	"rate_to_usd" double precision NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "exchange_rates_company_id_currency_code_pk" PRIMARY KEY("company_id","currency_code")
);
--> statement-breakpoint
CREATE TABLE "order_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"path" text NOT NULL,
	"original_name" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"uploaded_by" integer,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"user_id" integer,
	"kind" text NOT NULL,
	"payload" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"amount" double precision NOT NULL,
	"currency" text NOT NULL,
	"spent_on" text NOT NULL,
	"rates_snapshot" text DEFAULT '{}' NOT NULL,
	"receipt_path" text DEFAULT '' NOT NULL,
	"receipt_name" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_snapshot" double precision NOT NULL,
	"sell_price_snapshot" double precision DEFAULT 0 NOT NULL,
	"currency_snapshot" text NOT NULL,
	"moq_snapshot" integer NOT NULL,
	"line_total" double precision NOT NULL,
	"line_cbm" double precision NOT NULL,
	"line_weight_kg" double precision NOT NULL,
	"cartons_snapshot" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"direction" text NOT NULL,
	"amount" double precision NOT NULL,
	"currency" text NOT NULL,
	"paid_on" text NOT NULL,
	"rates_snapshot" text DEFAULT '{}' NOT NULL,
	"account" text DEFAULT '' NOT NULL,
	"receipt_path" text DEFAULT '' NOT NULL,
	"receipt_name" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"order_number" text NOT NULL,
	"client_id" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"display_currency" text DEFAULT 'USD' NOT NULL,
	"secondary_currency" text DEFAULT 'CNY' NOT NULL,
	"commission_pct" double precision DEFAULT 0 NOT NULL,
	"rates_snapshot" text DEFAULT '{}' NOT NULL,
	"bank_account_id" integer,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" integer NOT NULL,
	"updated_by" integer,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"path" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"supplier_id" integer,
	"price" double precision NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"moq" integer DEFAULT 1 NOT NULL,
	"lead_time_days" integer DEFAULT 0 NOT NULL,
	"quoted_on" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"sku" text NOT NULL,
	"name_en" text NOT NULL,
	"name_zh" text NOT NULL,
	"category_id" integer NOT NULL,
	"description_en" text DEFAULT '' NOT NULL,
	"description_zh" text DEFAULT '' NOT NULL,
	"price" double precision NOT NULL,
	"sell_price" double precision DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"moq" integer DEFAULT 1 NOT NULL,
	"qty_per_box" integer DEFAULT 1 NOT NULL,
	"length_cm" double precision DEFAULT 0 NOT NULL,
	"width_cm" double precision DEFAULT 0 NOT NULL,
	"height_cm" double precision DEFAULT 0 NOT NULL,
	"weight_kg" double precision DEFAULT 0 NOT NULL,
	"cbm" double precision DEFAULT 0 NOT NULL,
	"dimension_source" text DEFAULT 'carton' NOT NULL,
	"piece_length_cm" double precision DEFAULT 0 NOT NULL,
	"piece_width_cm" double precision DEFAULT 0 NOT NULL,
	"piece_height_cm" double precision DEFAULT 0 NOT NULL,
	"piece_weight_kg" double precision DEFAULT 0 NOT NULL,
	"packing_allowance_pct" double precision DEFAULT 15 NOT NULL,
	"supplier_id" integer,
	"duplicated_from_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"role" text DEFAULT 'collaborator' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_draft_images" ADD CONSTRAINT "capture_draft_images_draft_id_capture_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."capture_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_drafts" ADD CONSTRAINT "capture_drafts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_drafts" ADD CONSTRAINT "capture_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_drafts" ADD CONSTRAINT "capture_drafts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profile" ADD CONSTRAINT "company_profile_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_images" ADD CONSTRAINT "contact_images_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_events" ADD CONSTRAINT "entity_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_events" ADD CONSTRAINT "entity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate_history" ADD CONSTRAINT "exchange_rate_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_documents" ADD CONSTRAINT "order_documents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_documents" ADD CONSTRAINT "order_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_expenses" ADD CONSTRAINT "order_expenses_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_expenses" ADD CONSTRAINT "order_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_id_contacts_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_supplier_id_contacts_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_contacts_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_duplicated_from_id_products_id_fk" FOREIGN KEY ("duplicated_from_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_accounts_company_idx" ON "bank_accounts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "capture_draft_images_draft_idx" ON "capture_draft_images" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "capture_drafts_company_status_idx" ON "capture_drafts" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "categories_company_idx" ON "categories" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "contact_images_contact_idx" ON "contact_images" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contacts_company_type_idx" ON "contacts" USING btree ("company_id","type");--> statement-breakpoint
CREATE INDEX "entity_events_company_idx" ON "entity_events" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "entity_events_entity_idx" ON "entity_events" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "order_documents_order_idx" ON "order_documents" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_expenses_order_idx" ON "order_expenses" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_payments_order_idx" ON "order_payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_company_number_idx" ON "orders" USING btree ("company_id","order_number");--> statement-breakpoint
CREATE INDEX "orders_company_status_idx" ON "orders" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_suppliers_product_idx" ON "product_suppliers" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_suppliers_supplier_idx" ON "product_suppliers" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_company_sku_idx" ON "products" USING btree ("company_id","sku");--> statement-breakpoint
CREATE INDEX "products_company_category_idx" ON "products" USING btree ("company_id","category_id");--> statement-breakpoint
CREATE INDEX "products_company_active_idx" ON "products" USING btree ("company_id","active");--> statement-breakpoint
CREATE INDEX "products_supplier_idx" ON "products" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "users_company_idx" ON "users" USING btree ("company_id");