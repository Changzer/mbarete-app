UPDATE bank_accounts
SET track_balance = false
WHERE track_balance = true
  AND lower(trim(label)) NOT LIKE 'tailong%';
