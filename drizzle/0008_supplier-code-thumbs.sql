-- The factory's own style/model number (e.g. "AA012604240" off a spec card),
-- printed on order sheets so a supplier can match lines to their catalog.
ALTER TABLE "products" ADD COLUMN "supplier_code" text NOT NULL DEFAULT '';--> statement-breakpoint
-- A cropped shot of just the product, cut out of the booth photo by the
-- transcription pass. Used as the picker/export thumbnail; '' = none yet.
ALTER TABLE "products" ADD COLUMN "thumb_path" text NOT NULL DEFAULT '';
