-- Webhook event audit trail for payments. Every TRUSTED (HMAC-verified) incoming
-- webhook is recorded here for an auditable timeline (mirroring the PesaSwap
-- dashboard) and for idempotency. The primary key is the provider event id
-- (evt_...), so a retried delivery is a no-op. Additive + idempotent.
CREATE TABLE IF NOT EXISTS payment_events (
  id          TEXT PRIMARY KEY,
  venue_id    TEXT,
  payment_id  TEXT,
  event_type  TEXT NOT NULL DEFAULT '',
  status      TEXT,
  amount      BIGINT,
  currency    TEXT NOT NULL DEFAULT 'KES',
  raw         JSONB NOT NULL DEFAULT '{}',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_events_payment_idx ON payment_events (payment_id, received_at DESC);
CREATE INDEX IF NOT EXISTS payment_events_venue_idx ON payment_events (venue_id, received_at DESC);
