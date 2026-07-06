-- =====================================================================
-- Staff shifts + end-of-shift Z-report. A shift is opened (clock-in, with an
-- opening cash float) and closed (clock-out, with a counted cash drawer). On
-- close a Z-report is snapshotted: digital sales (M-Pesa/card/QR via the
-- payments ledger) + tips + tx count for the shift window, plus a cash
-- reconciliation (float + cash sales vs counted = variance). Minor units.
-- Additive + idempotent.
-- =====================================================================
CREATE TABLE IF NOT EXISTS shifts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      text NOT NULL,
  staff_id      uuid,
  staff_name    text,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  opening_float bigint NOT NULL DEFAULT 0,   -- cash in the drawer at open
  cash_sales    bigint NOT NULL DEFAULT 0,   -- cash taken during the shift (manual)
  cash_counted  bigint,                      -- counted drawer at close
  status        text NOT NULL DEFAULT 'open',-- open | closed
  report        jsonb,                       -- Z-report snapshot at close
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shifts_venue_idx ON shifts (venue_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS shifts_venue_open_idx ON shifts (venue_id, status);
