-- CNY is the ISO 4217 code. RMB survives only as a legacy input alias.
-- Where both rate rows exist, the already-canonical CNY row wins.
DELETE FROM exchange_rates AS rmb
USING exchange_rates AS cny
WHERE rmb.company_id = cny.company_id
  AND rmb.currency_code = 'RMB'
  AND cny.currency_code = 'CNY';
--> statement-breakpoint
UPDATE exchange_rates SET currency_code = 'CNY' WHERE upper(trim(currency_code)) = 'RMB';
--> statement-breakpoint
DELETE FROM exchange_rate_history AS rmb
USING exchange_rate_history AS cny
WHERE rmb.company_id = cny.company_id
  AND rmb.day = cny.day
  AND rmb.currency_code = 'RMB'
  AND cny.currency_code = 'CNY';
--> statement-breakpoint
UPDATE exchange_rate_history SET currency_code = 'CNY' WHERE upper(trim(currency_code)) = 'RMB';
--> statement-breakpoint
UPDATE products SET currency = 'CNY' WHERE upper(trim(currency)) = 'RMB';
--> statement-breakpoint
UPDATE products SET sell_currency = 'CNY' WHERE upper(trim(sell_currency)) = 'RMB';
--> statement-breakpoint
UPDATE product_suppliers SET currency = 'CNY' WHERE upper(trim(currency)) = 'RMB';
--> statement-breakpoint
UPDATE shipping_rates SET currency = 'CNY' WHERE upper(trim(currency)) = 'RMB';
--> statement-breakpoint
UPDATE company_profile SET functional_currency = 'CNY' WHERE upper(trim(functional_currency)) = 'RMB';
--> statement-breakpoint
UPDATE bank_accounts SET currency = 'CNY' WHERE upper(trim(currency)) = 'RMB';
--> statement-breakpoint
UPDATE orders SET display_currency = 'CNY' WHERE upper(trim(display_currency)) = 'RMB';
--> statement-breakpoint
UPDATE orders SET secondary_currency = 'CNY' WHERE upper(trim(secondary_currency)) = 'RMB';
--> statement-breakpoint
UPDATE order_items SET currency_snapshot = 'CNY' WHERE upper(trim(currency_snapshot)) = 'RMB';
--> statement-breakpoint
UPDATE order_items SET sell_currency_snapshot = 'CNY' WHERE upper(trim(sell_currency_snapshot)) = 'RMB';
--> statement-breakpoint
UPDATE order_payments SET currency = 'CNY' WHERE upper(trim(currency)) = 'RMB';
--> statement-breakpoint
UPDATE order_payments SET account = 'CNY' WHERE upper(trim(account)) = 'RMB';
--> statement-breakpoint
UPDATE order_expenses SET currency = 'CNY' WHERE upper(trim(currency)) = 'RMB';
--> statement-breakpoint
-- A snapshot containing both codes keeps CNY's value: its sort comes last.
UPDATE orders
SET rates_snapshot = (
  SELECT jsonb_object_agg(
    CASE WHEN entry.key = 'RMB' THEN 'CNY' ELSE entry.key END,
    entry.value
    ORDER BY CASE WHEN entry.key = 'CNY' THEN 1 ELSE 0 END, entry.key
  )::text
  FROM jsonb_each(rates_snapshot::jsonb) AS entry(key, value)
)
WHERE rates_snapshot::jsonb ? 'RMB';
--> statement-breakpoint
UPDATE order_payments
SET rates_snapshot = (
  SELECT jsonb_object_agg(
    CASE WHEN entry.key = 'RMB' THEN 'CNY' ELSE entry.key END,
    entry.value
    ORDER BY CASE WHEN entry.key = 'CNY' THEN 1 ELSE 0 END, entry.key
  )::text
  FROM jsonb_each(rates_snapshot::jsonb) AS entry(key, value)
)
WHERE rates_snapshot::jsonb ? 'RMB';
--> statement-breakpoint
UPDATE order_expenses
SET rates_snapshot = (
  SELECT jsonb_object_agg(
    CASE WHEN entry.key = 'RMB' THEN 'CNY' ELSE entry.key END,
    entry.value
    ORDER BY CASE WHEN entry.key = 'CNY' THEN 1 ELSE 0 END, entry.key
  )::text
  FROM jsonb_each(rates_snapshot::jsonb) AS entry(key, value)
)
WHERE rates_snapshot::jsonb ? 'RMB';
--> statement-breakpoint
UPDATE capture_drafts
SET fields = jsonb_set(fields::jsonb, '{currency}', '"CNY"', false)::text
WHERE fields::jsonb ->> 'currency' = 'RMB';
--> statement-breakpoint
UPDATE capture_drafts
SET fields = jsonb_set(fields::jsonb, '{sellCurrency}', '"CNY"', false)::text
WHERE fields::jsonb ->> 'sellCurrency' = 'RMB';
