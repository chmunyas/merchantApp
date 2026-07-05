-- Server-authoritative kitchen orders. Additive + idempotent.
CREATE TABLE IF NOT EXISTS orders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   TEXT NOT NULL,
  table_id   TEXT,
  staff_id   UUID,
  status     TEXT NOT NULL DEFAULT 'new',
  total      BIGINT NOT NULL DEFAULT 0,
  currency   TEXT NOT NULL DEFAULT 'KES',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_venue_status ON orders (venue_id, status);

CREATE TABLE IF NOT EXISTS order_items (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  name     TEXT NOT NULL,
  qty      INT NOT NULL DEFAULT 1,
  price    BIGINT NOT NULL DEFAULT 0,
  notes    TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
