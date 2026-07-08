-- Pre-orders: let a customer choose how + when they want the order. Additive with
-- a back-compatible default (existing orders stay dine-in, ASAP). fulfillment_type
-- is one of dine_in | collection | delivery. scheduled_at NULL means ASAP.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'dine_in';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS orders_scheduled_idx ON orders (venue_id, scheduled_at)
  WHERE scheduled_at IS NOT NULL;
