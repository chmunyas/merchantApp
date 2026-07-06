-- Server-bound, single-use, expiring pay tokens for QR orders. The amount is
-- never trusted from the URL — the pay page resolves this opaque token to the
-- authoritative order total. Closes the amount-tamper hole (Walking QR security
-- model, minus EMVCo).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_token TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_pay_token_key
  ON orders (pay_token) WHERE pay_token IS NOT NULL;
