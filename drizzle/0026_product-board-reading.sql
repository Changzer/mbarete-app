ALTER TABLE "products" ADD COLUMN "board_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "ai_notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "products" p
SET "board_text" = COALESCE(sub.board, ''),
    "ai_notes" = COALESCE(sub.notes, '')
FROM (
  SELECT DISTINCT ON (d.company_id, d.product_id)
         d.company_id,
         d.product_id,
         CASE WHEN d.transcript LIKE '{%' THEN d.transcript::jsonb ->> 'boardText' END AS board,
         d.transcript_notes AS notes
  FROM "capture_drafts" d
  WHERE d.status = 'imported' AND d.product_id IS NOT NULL
  ORDER BY d.company_id, d.product_id, d.id DESC
) sub
WHERE sub.company_id = p.company_id AND sub.product_id = p.id;
