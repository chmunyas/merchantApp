-- =====================================================================
-- Period close / lock — an accounting control that freezes a fiscal period.
--
-- Once a period is closed, no journal entry may be posted with an entry_date on
-- or before its period_end (postEntry enforces this). This protects filed/
-- reported periods from being changed after the fact. A period can be reopened
-- by an authorised operator if a correction is genuinely required.
-- Additive + idempotent.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ledger_periods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    TEXT NOT NULL,
  period_end  DATE NOT NULL,          -- everything on/before this date is locked
  status      TEXT NOT NULL DEFAULT 'closed',  -- closed | open (reopened)
  note        TEXT,
  closed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by   TEXT,
  UNIQUE (venue_id, period_end)
);
CREATE INDEX IF NOT EXISTS ledger_periods_venue_idx
  ON ledger_periods (venue_id, period_end DESC);
