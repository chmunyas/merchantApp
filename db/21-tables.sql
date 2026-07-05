-- Server-authoritative dining tables / floor plan. Replaces the
-- merchant_state tables blob with per-row, venue-scoped records.
-- Additive + idempotent.
CREATE TABLE IF NOT EXISTS dining_tables (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   TEXT NOT NULL,
  label      TEXT NOT NULL,
  seats      INT NOT NULL DEFAULT 2,
  section    TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dining_tables_venue ON dining_tables (venue_id);

