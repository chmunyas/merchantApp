-- Reseller commission ledger — a durable, per-payment audit trail of the revenue
-- share owed to an org (bank) for its merchants' processed volume. Posted once per
-- succeeded payment (unique on payment_id). Additive + idempotent.
CREATE TABLE IF NOT EXISTS commission_ledger (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  venue_id          TEXT NOT NULL,
  payment_id        TEXT,
  gross_amount      BIGINT NOT NULL,
  commission_bps    INT NOT NULL,
  commission_amount BIGINT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commission_ledger_org_idx ON commission_ledger (org_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS commission_ledger_payment_idx
  ON commission_ledger (payment_id) WHERE payment_id IS NOT NULL;
