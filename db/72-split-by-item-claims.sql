-- A2.2 split-by-item: a per-line reservation so two guests can never pay for the
-- same dish, and a paid line can never be claimed again.
--
-- This is the SAME reservation discipline as db/62 payment_holds (A2.5), one
-- level finer: `payment_holds` reserves an AMOUNT of a bill, this reserves the
-- specific LINES that amount was derived from. A claim is granted under the same
-- `SELECT ... FROM orders FOR UPDATE` serialisation, so the two stay consistent.
--
-- A held claim carries its own expiry, so an abandoned checkout, a declined
-- M-Pesa prompt or a crashed isolate frees the dish again with no intervention.
-- A claim is promoted to 'paid' once a succeeded payment carries its claim key;
-- 'paid' rows never expire and are never re-claimable. `amount` is the line's
-- apportioned share of the order total (see src/lib/split-apportion.ts) in minor
-- units, recorded so a settled split is auditable line by line.

CREATE TABLE IF NOT EXISTS order_item_claims (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      TEXT NOT NULL,
  order_id      UUID NOT NULL,
  order_item_id UUID NOT NULL,
  claim_key     TEXT NOT NULL,
  amount        BIGINT NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'held',
  payment_id    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);

ALTER TABLE order_item_claims
  DROP CONSTRAINT IF EXISTS order_item_claims_status_known;

ALTER TABLE order_item_claims
  ADD CONSTRAINT order_item_claims_status_known
  CHECK (status IN ('held', 'paid'));

ALTER TABLE order_item_claims
  DROP CONSTRAINT IF EXISTS order_item_claims_amount_non_negative;

ALTER TABLE order_item_claims
  ADD CONSTRAINT order_item_claims_amount_non_negative
  CHECK (amount >= 0);

-- One live claim per line, enforced by the database and not merely by the
-- read-then-write in the application: this is the race guard.
CREATE UNIQUE INDEX IF NOT EXISTS order_item_claims_line_idx
  ON order_item_claims (order_item_id);

CREATE INDEX IF NOT EXISTS order_item_claims_order_idx
  ON order_item_claims (order_id, status);

CREATE INDEX IF NOT EXISTS order_item_claims_key_idx
  ON order_item_claims (order_id, claim_key);

CREATE INDEX IF NOT EXISTS order_item_claims_venue_idx
  ON order_item_claims (venue_id, created_at DESC);
