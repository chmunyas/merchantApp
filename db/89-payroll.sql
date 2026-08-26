-- Payroll: a fixed salary per staff member per period, and the payouts it issues.
--
-- There was no payroll of any kind before this — no rate on the staff record, no
-- hours aggregation, and the "salary" seen in the dashboard was hardcoded demo
-- data with no backend behind it.
--
-- Salary is a FIXED amount per period, not hours x rate. Shifts today record a
-- cash Z-report (opened_at/closed_at/float/counted), not an attested timesheet,
-- so deriving pay from them would give a wage the venue cannot defend. The
-- schema leaves room for an hourly basis later: `basis` is a column, not an
-- assumption.
--
-- Amounts are minor units (KES cents), like every other money column here.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS salary_amount BIGINT
  CHECK (salary_amount IS NULL OR salary_amount >= 0);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS salary_period TEXT
  CHECK (salary_period IS NULL OR salary_period IN ('weekly', 'biweekly', 'monthly'));
ALTER TABLE staff ADD COLUMN IF NOT EXISTS salary_basis TEXT NOT NULL DEFAULT 'fixed'
  CHECK (salary_basis IN ('fixed'));
ALTER TABLE staff ADD COLUMN IF NOT EXISTS salary_updated_at TIMESTAMPTZ;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS salary_updated_by TEXT;

-- One salary payout per staff member per run. Deliberately a sibling of
-- tip_payouts rather than a rewrite of it: tip_payouts is wired to allocations,
-- cadence and the ledger, and merging the two while also introducing approval
-- would make a behavioural change and a large move impossible to review apart.
-- The provider submission path is what the two share (src/lib/payout-provider.ts).
CREATE TABLE IF NOT EXISTS salary_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        TEXT NOT NULL,
  run_id          UUID NOT NULL REFERENCES staff_payout_runs(id),
  staff_id        UUID NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  amount          BIGINT NOT NULL CHECK (amount > 0),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'held', 'processing', 'confirmed',
                                      'failed', 'unknown')),
  held_reason     TEXT,
  idempotency_key TEXT NOT NULL,
  provider_ref    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ,
  UNIQUE (venue_id, idempotency_key),
  -- A person is paid once per run. This is the guard against a double salary.
  UNIQUE (run_id, staff_id)
);

CREATE INDEX IF NOT EXISTS salary_payouts_venue_status_idx
  ON salary_payouts (venue_id, status, created_at);
CREATE INDEX IF NOT EXISTS salary_payouts_staff_idx
  ON salary_payouts (venue_id, staff_id, created_at DESC);
