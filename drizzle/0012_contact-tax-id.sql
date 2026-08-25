-- The client's fiscal registration (RUC / CNPJ / 统一社会信用代码) — what an
-- invoice legally names its buyer by. On contacts rather than a client-only
-- table: suppliers have one too, and the form is shared.
ALTER TABLE "contacts" ADD COLUMN "tax_id" text DEFAULT '' NOT NULL;
