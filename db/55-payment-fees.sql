-- Store the processing fee (minor units) charged on each settled payment, so the
-- merchant can see the real blended effective rate they pay across methods — the
-- "no bill shock" fee-transparency cockpit. Computed on first success from the
-- payment's method; NULL for unsettled/failed attempts.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fee_amount BIGINT;
