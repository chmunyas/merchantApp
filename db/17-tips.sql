-- Tip attribution, pooling, and allocation ledger. Additive + idempotent.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS staff_id UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tip_amount BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS tip_pools (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   TEXT NOT NULL,
  rule       TEXT NOT NULL DEFAULT 'equal',
  period     TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tip_allocations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id    UUID,
  venue_id   TEXT NOT NULL,
  staff_id   UUID,
  amount     BIGINT NOT NULL DEFAULT 0,
  period     TEXT,
  paid_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
