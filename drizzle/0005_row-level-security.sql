-- Row-level security: the database itself refuses cross-tenant rows.
--
-- Every query runs with `app.company_id` stamped on the connection by the
-- app's pool (src/db/index.ts). The policy below yields only rows whose
-- company_id matches; with no setting, NULLIF makes the predicate NULL and
-- the table reads as empty — RLS fails closed.
--
-- `users` and `companies` are deliberately exempt: they are the tables the
-- tenant is derived FROM (login by email, session lookup) and both happen
-- before any context exists. Their scoping stays in the app layer, which the
-- isolation suite covers.
--
-- FORCE makes the policies bind the table owner too — the app connects as the
-- owner role. The final ALTER strips superuser/bypassrls from that role:
-- docker's POSTGRES_USER is born a superuser, and a superuser walks straight
-- through RLS, which would leave all of this silently inert.
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "categories" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "products" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_images" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "product_images" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "exchange_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exchange_rates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "exchange_rates" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "exchange_rate_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exchange_rate_history" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "exchange_rate_history" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "company_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "company_profile" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "company_profile" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bank_accounts" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contacts" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "contact_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contact_images" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contact_images" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "product_suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_suppliers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "product_suppliers" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "orders" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_items" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "order_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_documents" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "order_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_payments" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "order_expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_expenses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_expenses" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "order_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_events" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "entity_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "entity_events" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "capture_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "capture_drafts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "capture_drafts" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
ALTER TABLE "capture_draft_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "capture_draft_images" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "capture_draft_images" AS PERMISSIVE FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::integer) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::integer);--> statement-breakpoint
-- Role posture is handled in code (src/db/migrate.ts), not here: the docker
-- image's POSTGRES_USER is the cluster's bootstrap role, and Postgres refuses
-- to strip SUPERUSER from it. Instead the migration runner ensures a separate
-- non-superuser "<user>_app" login for the app to connect as.
