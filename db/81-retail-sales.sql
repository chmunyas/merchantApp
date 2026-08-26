-- Retail counter: a sell price on the catalogue, and a durable sales ledger.
--
-- `inventory_items` already held the catalogue and stock server-side, but it
-- carried only `cost` — there was nowhere to record what an item SELLS for. That
-- single missing column is why the retail counter kept its products, prices and
-- sales in the browser, which meant two tills disagreed and a cleared cache
-- destroyed the day's takings.
--
-- Line `name`, `unit_price_minor` and `unit_cost_minor` are SNAPSHOTS. A receipt
-- and a margin report must keep saying what was actually sold and what it
-- actually cost, even after the catalogue is repriced or the item is deleted.
--
-- SKU uniqueness is deliberately NOT enforced here: `sku` already exists and may
-- hold duplicates, and failing this migration on legacy data would block every
-- later one. Dedupe first, then add the unique index in a follow-up. `barcode`
-- is new, so it can be unique from birth.

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS price BIGINT NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_price_non_negative;
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_price_non_negative
  CHECK (price >= 0 AND cost >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_barcode_key
  ON inventory_items (venue_id, barcode) WHERE barcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_items_sku_idx
  ON inventory_items (venue_id, sku) WHERE sku IS NOT NULL;

CREATE TABLE IF NOT EXISTS retail_sales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  staff_id        UUID,
  customer_name   TEXT,
  customer_phone  TEXT,
  subtotal_minor  BIGINT NOT NULL DEFAULT 0,
  discount_minor  BIGINT NOT NULL DEFAULT 0,
  total_minor     BIGINT NOT NULL DEFAULT 0,
  cost_minor      BIGINT NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'KES',
  payment_method  TEXT NOT NULL DEFAULT 'cash',
  payment_id      TEXT,
  status          TEXT NOT NULL DEFAULT 'completed',
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE retail_sales DROP CONSTRAINT IF EXISTS retail_sales_amounts;
ALTER TABLE retail_sales ADD CONSTRAINT retail_sales_amounts
  CHECK (
    subtotal_minor >= 0 AND discount_minor >= 0 AND total_minor >= 0
    AND cost_minor >= 0 AND discount_minor <= subtotal_minor
  );

ALTER TABLE retail_sales DROP CONSTRAINT IF EXISTS retail_sales_status_known;
ALTER TABLE retail_sales ADD CONSTRAINT retail_sales_status_known
  CHECK (status IN ('completed', 'voided'));

ALTER TABLE retail_sales DROP CONSTRAINT IF EXISTS retail_sales_method_known;
ALTER TABLE retail_sales ADD CONSTRAINT retail_sales_method_known
  CHECK (payment_method IN ('cash', 'mpesa', 'card', 'credit', 'bnpl'));

-- A double-tapped till button must not ring the sale twice.
CREATE UNIQUE INDEX IF NOT EXISTS retail_sales_idempotency_key
  ON retail_sales (venue_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS retail_sales_venue_created_idx
  ON retail_sales (venue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS retail_sales_venue_staff_idx
  ON retail_sales (venue_id, staff_id, created_at DESC);

CREATE TABLE IF NOT EXISTS retail_sale_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id         TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  sale_id          UUID NOT NULL REFERENCES retail_sales(id) ON DELETE CASCADE,
  item_id          UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  qty              NUMERIC(12, 3) NOT NULL,
  unit_price_minor BIGINT NOT NULL DEFAULT 0,
  unit_cost_minor  BIGINT NOT NULL DEFAULT 0,
  total_minor      BIGINT NOT NULL DEFAULT 0,
  display_order    INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE retail_sale_lines DROP CONSTRAINT IF EXISTS retail_sale_lines_amounts;
ALTER TABLE retail_sale_lines ADD CONSTRAINT retail_sale_lines_amounts
  CHECK (qty > 0 AND unit_price_minor >= 0 AND unit_cost_minor >= 0 AND total_minor >= 0);

CREATE INDEX IF NOT EXISTS retail_sale_lines_sale_idx
  ON retail_sale_lines (venue_id, sale_id, display_order);

CREATE INDEX IF NOT EXISTS retail_sale_lines_item_idx
  ON retail_sale_lines (venue_id, item_id);
