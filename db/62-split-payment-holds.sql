-- A2.5 split-payment concurrency lock.
-- Two guests paying the same bill at the same moment both read the outstanding
-- balance BEFORE either payment reaches the ledger, so both are granted the whole
-- remainder and the check is overpaid. A short-lived hold row makes an in-flight
-- share visible to concurrent readers; the grant itself is serialised on the
-- order row (SELECT ... FOR UPDATE) so only one grant runs at a time per bill.
--
-- Holds are advisory and self-healing: they carry their own expiry, so an
-- abandoned checkout, a crashed isolate or a declined card never permanently
-- locks part of a bill. A hold is keyed by the caller's idempotency key, so a
-- retry re-competes for its own share instead of blocking itself.

CREATE TABLE IF NOT EXISTS payment_holds (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   TEXT NOT NULL,
  order_id   UUID NOT NULL,
  hold_key   TEXT NOT NULL,
  amount     BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_holds_order_key_idx
  ON payment_holds (order_id, hold_key);

CREATE INDEX IF NOT EXISTS payment_holds_live_idx
  ON payment_holds (order_id, expires_at);

CREATE INDEX IF NOT EXISTS payment_holds_venue_idx
  ON payment_holds (venue_id, created_at DESC);
