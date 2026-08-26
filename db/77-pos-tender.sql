-- C5.6 / C5.7 / C5.11 / B2.9 — pushing a captured payment back onto the POS
-- check as a distinct tender, and telling a server when it did not land.
--
-- Two tables, and the split between them is the whole design:
--
--   * `pos_tender_map` — which POS payment method IS us. Sunday's Toast setup
--     creates a `sunday` method under Other Payment Options, plus a second
--     exception tender that must only ever be used when support says so or when
--     an Unsynced Payment alert fires. Recording both, with roles, is what lets
--     reconciliation later tell "attributed to the wrong tender" (discrepancy
--     class 2) from a genuine mismatch.
--
--   * `pos_tender_pushes` — one row per payment, holding the durable INTENT to
--     tell the POS about it. The financial outbox consumer only ever writes this
--     row; a separate leased worker makes the network call. A consumer runs
--     inside the payment's transaction, and holding a row lock open across an
--     HTTP round trip to a POS would be a self-inflicted outage. This is the
--     same two-stage shape `outbound_deliveries` already uses for messaging.
--
-- `UNIQUE (venue_id, payment_id)` is the idempotency guard: a payment can never
-- be tendered onto a check twice, however often the outbox replays. It also
-- gives Sunday's split rule for free — N payments on one bill produce N rows and
-- therefore N separate tender lines, never one aggregated line.
--
-- Additive + idempotent. No venue has a tender map or a push row until it
-- connects a POS, and the consumer records `skipped` for everyone else, so
-- nothing changes for a venue without one.

-- ---------------------------------------------------------------------------
-- 1. C5.6 / C5.7 — the tender map.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_tender_map (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id              TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  connection_id         UUID NOT NULL REFERENCES pos_connections(id) ON DELETE CASCADE,
  pos_payment_method_id TEXT NOT NULL,
  label                 TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'other',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pos_tender_map DROP CONSTRAINT IF EXISTS pos_tender_map_role_known;
ALTER TABLE pos_tender_map ADD CONSTRAINT pos_tender_map_role_known
  CHECK (role IN ('sunday', 'exception', 'other'));

CREATE UNIQUE INDEX IF NOT EXISTS pos_tender_map_method_key
  ON pos_tender_map (venue_id, pos_payment_method_id);

-- Exactly one tender can be "us", and one can be the exception. Ambiguity here
-- would mean a payment landing under a method reconciliation does not recognise.
CREATE UNIQUE INDEX IF NOT EXISTS pos_tender_map_one_sunday
  ON pos_tender_map (venue_id) WHERE role = 'sunday';
CREATE UNIQUE INDEX IF NOT EXISTS pos_tender_map_one_exception
  ON pos_tender_map (venue_id) WHERE role = 'exception';

-- ---------------------------------------------------------------------------
-- 2. C5.6 / C5.11 / B2.9 — the push intent and its outcome.
-- ---------------------------------------------------------------------------
-- `status` carries Sunday's own vocabulary so the payments page can show it
-- verbatim:
--   pending       queued; the worker has not reached it yet
--   notified      the POS confirmed receipt
--   not_notified  we could not tell the POS. The money IS collected; a human
--                 must record it manually. This is what raises B2.9.
--   skipped       nothing to tell — no POS connection, or no bill to attach to
--   manual        a manager recorded it on the POS by hand
--
-- `amount_minor` is what actually goes to the POS: subtotal + tip, with the
-- guest's digital fee EXCLUDED (the guest pays that to us, not to the venue, and
-- pushing it would overstate the check).
CREATE TABLE IF NOT EXISTS pos_tender_pushes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id         TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  payment_id       TEXT NOT NULL,
  check_id         UUID REFERENCES pos_checks(id) ON DELETE SET NULL,
  pos_bill_id      TEXT,
  order_id         UUID,
  amount_minor     BIGINT NOT NULL DEFAULT 0,
  tip_minor        BIGINT NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pending',
  pos_payment_id   TEXT,
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_expires_at TIMESTAMPTZ,
  claim_token      UUID,
  last_error       TEXT,
  last_error_code  TEXT,
  notified_at      TIMESTAMPTZ,
  alerted_at       TIMESTAMPTZ,
  recorded_by      TEXT,
  recorded_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pos_tender_pushes DROP CONSTRAINT IF EXISTS pos_tender_pushes_status_known;
ALTER TABLE pos_tender_pushes ADD CONSTRAINT pos_tender_pushes_status_known
  CHECK (status IN ('pending', 'notified', 'not_notified', 'skipped', 'manual'));

ALTER TABLE pos_tender_pushes DROP CONSTRAINT IF EXISTS pos_tender_pushes_amounts;
ALTER TABLE pos_tender_pushes ADD CONSTRAINT pos_tender_pushes_amounts
  CHECK (amount_minor >= 0 AND tip_minor >= 0 AND tip_minor <= amount_minor);

-- The idempotency guard. One push per payment, forever.
CREATE UNIQUE INDEX IF NOT EXISTS pos_tender_pushes_payment_key
  ON pos_tender_pushes (venue_id, payment_id);

CREATE INDEX IF NOT EXISTS pos_tender_pushes_due_idx
  ON pos_tender_pushes (next_attempt_at)
  WHERE status = 'pending';

-- Drives the Unsynced Payment list and the B2.9 alert sweep.
CREATE INDEX IF NOT EXISTS pos_tender_pushes_unsynced_idx
  ON pos_tender_pushes (venue_id, updated_at DESC)
  WHERE status = 'not_notified';
