-- Phase 3 server-authoritative payment intents.
-- A random single-use token binds the tenant, amount, currency, source object,
-- allowed method, tip limits, and expiry before /api/payments/create can move money.

CREATE TABLE IF NOT EXISTS payment_intents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash            TEXT NOT NULL UNIQUE,
  venue_id              TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  amount                BIGINT NOT NULL CHECK (amount > 0),
  currency              TEXT NOT NULL DEFAULT 'KES',
  source_type           TEXT NOT NULL,
  source_id             TEXT,
  allowed_method        TEXT,
  max_tip_amount        BIGINT NOT NULL DEFAULT 0 CHECK (max_tip_amount >= 0),
  metadata              JSONB NOT NULL DEFAULT '{}',
  expires_at            TIMESTAMPTZ NOT NULL,
  consumed_at           TIMESTAMPTZ,
  consumed_payment_id   TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_intents_active_idx
  ON payment_intents (venue_id, expires_at)
  WHERE consumed_at IS NULL;

-- Bind order lines to immutable catalogue ids while retaining name/price snapshots
-- for receipts and historical reporting.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS menu_item_id UUID;
CREATE INDEX IF NOT EXISTS order_items_menu_item_idx ON order_items (menu_item_id);
