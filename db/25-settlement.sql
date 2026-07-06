-- Settlement batches for bank and merchant reconciliation.
CREATE TABLE IF NOT EXISTS settlements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     TEXT NOT NULL,
  period_start DATE,
  period_end   DATE,
  gross        BIGINT NOT NULL DEFAULT 0,
  fees         BIGINT NOT NULL DEFAULT 0,
  net          BIGINT NOT NULL DEFAULT 0,
  tx_count     INT NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'settled',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS settlement_id UUID;

CREATE INDEX IF NOT EXISTS settlements_venue_created_idx
  ON settlements (venue_id, created_at DESC);
