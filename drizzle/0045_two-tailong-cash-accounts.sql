UPDATE bank_accounts
SET track_balance = false
WHERE track_balance = true
  AND (
    lower(trim(label)) NOT LIKE 'tailong%'
    OR upper(trim(currency)) NOT IN ('CNY', 'USD')
  );
--> statement-breakpoint
WITH ranked_tailong AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY company_id, upper(trim(currency))
      ORDER BY
        track_balance DESC,
        lower(trim(label)) IN ('tailong rmb', 'tailong usd') DESC,
        id
    ) AS cash_rank
  FROM bank_accounts
  WHERE lower(trim(label)) LIKE 'tailong%'
    AND upper(trim(currency)) IN ('CNY', 'USD')
)
UPDATE bank_accounts AS target
SET track_balance = ranked.cash_rank = 1
FROM ranked_tailong AS ranked
WHERE target.id = ranked.id;
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_tracked_currency_uq"
ON "bank_accounts" ("company_id", (upper(trim("currency"))))
WHERE "track_balance" = true;
--> statement-breakpoint
INSERT INTO bank_accounts (company_id, label, currency, track_balance)
SELECT companies.id, required.label, required.currency, true
FROM companies
CROSS JOIN (
  VALUES
    ('Tailong RMB', 'CNY'),
    ('Tailong USD', 'USD')
) AS required(label, currency)
WHERE NOT EXISTS (
  SELECT 1
  FROM bank_accounts
  WHERE bank_accounts.company_id = companies.id
    AND bank_accounts.track_balance = true
    AND upper(trim(bank_accounts.currency)) = required.currency
);
