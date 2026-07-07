-- =====================================================================
-- Promo / offer codes — customer-applied discounts on an order.
-- Additive + idempotent. Amounts are MINOR units (cents), matching orders.total.
-- =====================================================================
CREATE TABLE IF NOT EXISTS promo_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     text NOT NULL,
  code         text NOT NULL,
  kind         text NOT NULL DEFAULT 'percent',   -- percent | fixed
  value        bigint NOT NULL DEFAULT 0,          -- percent (0-100) OR fixed minor units
  min_order    bigint NOT NULL DEFAULT 0,          -- minor units; 0 = no minimum
  max_discount bigint NOT NULL DEFAULT 0,          -- minor units cap for percent; 0 = no cap
  active       boolean NOT NULL DEFAULT true,
  starts_at    timestamptz,
  expires_at   timestamptz,
  usage_limit  int NOT NULL DEFAULT 0,             -- 0 = unlimited total redemptions
  used_count   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- One code per venue (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS promo_codes_venue_code_idx
  ON promo_codes (venue_id, lower(code));

-- The discount actually applied to an order + which code was used.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount bigint NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code text;
