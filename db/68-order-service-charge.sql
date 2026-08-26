-- Records the service charge / auto-gratuity already present on a bill, so the
-- guest checkout can tier its additional tip suggestions against it (A3.2).
-- Additive only: existing orders default to 0, which is the "no service charge"
-- case and yields the standard 20/23/25% tip options — identical to today's
-- behaviour, so a fresh database and a migrated one render the same page.
-- Auto-gratuity is configured in the POS, never in this app; this column is the
-- landing spot for that value once a bill is imported.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS service_charge BIGINT NOT NULL DEFAULT 0;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_service_charge_non_negative;

ALTER TABLE orders
  ADD CONSTRAINT orders_service_charge_non_negative
  CHECK (service_charge >= 0);
