-- Disputes / chargebacks against a payment. A dispute arrives on a trusted webhook
-- (either the payment object carries a disputes[] array, or the event IS a dispute
-- with a dispute_id) and is upserted here so the merchant can see and act on it.
-- Amounts are minor units (cents). Additive + idempotent.
CREATE TABLE IF NOT EXISTS disputes (
  id                   TEXT PRIMARY KEY,
  venue_id             TEXT,
  payment_id           TEXT,
  amount               BIGINT NOT NULL DEFAULT 0,
  currency             TEXT NOT NULL DEFAULT 'KES',
  status               TEXT NOT NULL DEFAULT 'open',
  reason               TEXT,
  connector_dispute_id TEXT,
  evidence_due_by      TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disputes_venue_idx ON disputes (venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS disputes_payment_idx ON disputes (payment_id);
