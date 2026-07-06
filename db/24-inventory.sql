-- =====================================================================
-- Server-authoritative inventory for retail and supermarket venues
-- Venue-scoped stock levels, COGS, adjustments, and reorder alerts
-- =====================================================================
CREATE TABLE IF NOT EXISTS inventory_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     text NOT NULL,
  name         text NOT NULL,
  sku          text,
  unit         text NOT NULL DEFAULT 'unit',
  stock        numeric NOT NULL DEFAULT 0,
  reorder_level numeric NOT NULL DEFAULT 0,
  cost         bigint NOT NULL DEFAULT 0,
  supplier     text,
  menu_item_id uuid REFERENCES menu_items(id) ON DELETE SET NULL,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   text NOT NULL,
  item_id    uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  delta      numeric NOT NULL,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_items_venue_idx ON inventory_items (venue_id);
CREATE INDEX IF NOT EXISTS inventory_movements_venue_idx ON inventory_movements (venue_id);
