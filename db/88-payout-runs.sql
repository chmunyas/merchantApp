-- Manager-approved payout runs, shared by tips (B4) and salaries.
--
-- Until now money could leave the building with no human approving it: the
-- weekly cadence called issueDueTipPayouts -> submitTipPayouts on a cron, and
-- "manager only" was a role check on one endpoint, not a recorded decision.
-- `requested_by` recorded who triggered a batch, never who authorised it.
--
-- A run is now the unit of authorisation. Individual payouts hang off a run and
-- may only be submitted to the provider while their run is `approved` (or
-- `submitted`, so a partial batch can be retried). Approval records WHO and
-- WHEN, and flags the case where the approver is also being paid by the run —
-- that is permitted by policy but must never be invisible.
--
-- Existing `tip_payouts` rows are left with a NULL run_id. They are historical
-- and already settled; the submit path only ever looks at `pending` rows, and a
-- pending row with no run cannot be submitted (see the guard in the app).
CREATE TABLE IF NOT EXISTS staff_payout_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('tips', 'salary')),
  -- '2026-W34' for a tip week, '2026-08' for a salary month.
  period_label    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending_approval'
                    CHECK (status IN ('pending_approval', 'approved', 'rejected',
                                      'submitted', 'completed', 'cancelled')),
  currency        TEXT NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  total_amount    BIGINT NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  staff_count     INTEGER NOT NULL DEFAULT 0 CHECK (staff_count >= 0),
  note            TEXT,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  -- True when the approver appears in their own run. Policy allows it; the
  -- audit trail must still show it.
  self_approved   BOOLEAN NOT NULL DEFAULT false,
  rejected_by     TEXT,
  rejected_at     TIMESTAMPTZ,
  rejection_reason TEXT,
  submitted_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_payout_runs_venue_idx
  ON staff_payout_runs (venue_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS staff_payout_runs_awaiting_idx
  ON staff_payout_runs (venue_id, status)
  WHERE status = 'pending_approval';

-- One OPEN run per venue/kind/period. A rejected or cancelled run does not block
-- a corrected one for the same period.
CREATE UNIQUE INDEX IF NOT EXISTS staff_payout_runs_open_uidx
  ON staff_payout_runs (venue_id, kind, period_label)
  WHERE status NOT IN ('rejected', 'cancelled');

DO $approval$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_payout_runs_approval_complete'
  ) THEN
    -- An approved run without an approver is an unsigned cheque.
    ALTER TABLE staff_payout_runs ADD CONSTRAINT staff_payout_runs_approval_complete
      CHECK (
        status NOT IN ('approved', 'submitted', 'completed')
        OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_payout_runs_rejection_complete'
  ) THEN
    ALTER TABLE staff_payout_runs ADD CONSTRAINT staff_payout_runs_rejection_complete
      CHECK (status <> 'rejected' OR (rejected_by IS NOT NULL AND rejected_at IS NOT NULL));
  END IF;
END
$approval$;

ALTER TABLE tip_payouts ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES staff_payout_runs(id);
CREATE INDEX IF NOT EXISTS tip_payouts_run_idx ON tip_payouts (run_id);
