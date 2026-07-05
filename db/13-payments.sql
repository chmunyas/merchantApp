-- Persistent payment ledger (foundation for settlement + reconciliation).
-- Replaces the in-memory Map in api/payments.ts so records survive restarts and
-- are shared across the worker pool. Amounts are in minor units (cents).
CREATE TABLE IF NOT EXISTS payments (
  id           TEXT PRIMARY KEY,
  venue_id     TEXT,
  kind         TEXT NOT NULL DEFAULT 'payment',
  amount       BIGINT NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'KES',
  status       TEXT NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'pesaswap',
  provider_ref TEXT,
  reference    TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_venue_idx ON payments (venue_id, created_at DESC);
