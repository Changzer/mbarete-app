-- The tenant's own logo for their proforma letterhead. A path into the
-- uploads volume like every other tenant file; empty means a text-only
-- letterhead. Fixes all tenants printing the platform's trading logo.
ALTER TABLE "company_profile" ADD COLUMN "logo_path" text NOT NULL DEFAULT '';
