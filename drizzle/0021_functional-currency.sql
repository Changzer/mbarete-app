-- The company's functional currency: what its profit is real in. Order
-- results and the finance report open in it; empty means "not chosen",
-- which the app resolves to RMB when the rate table has it.
ALTER TABLE "company_profile" ADD COLUMN "functional_currency" text DEFAULT '' NOT NULL;
