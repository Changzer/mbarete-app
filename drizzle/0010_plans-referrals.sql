-- Growth rails: each company can carry a shareable referral code that admits
-- another company through /signup, and remembers whose link brought it in.
-- Plan limits live in code (src/lib/plans.ts) — the database keeps only the
-- plan name, which 0009 did not need to add because it has existed since the
-- companies table was born.
ALTER TABLE "companies" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "referred_by_company_id" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_referral_code_unique" UNIQUE("referral_code");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_referred_by_company_id_companies_id_fk" FOREIGN KEY ("referred_by_company_id") REFERENCES "companies"("id") ON DELETE no action ON UPDATE no action;
