-- Per-venue subscription state for the M-Pesa-billed plan tiers. One row per
-- venue (the venue's current plan + billing period). The authoritative plan for
-- limits still lives on app_users.plan (the JWT claim); this table drives the
-- billing UI, renewals + dunning. Amounts are minor units (cents). Additive.
CREATE TABLE IF NOT EXISTS subscriptions (
  venue_id            TEXT PRIMARY KEY,
  plan                TEXT NOT NULL DEFAULT 'free',
  status              TEXT NOT NULL DEFAULT 'active', -- active | past_due | canceled
  current_period_end  TIMESTAMPTZ,
  last_payment_id     TEXT,
  amount              BIGINT NOT NULL DEFAULT 0,      -- charged per period (minor units)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_period_idx
  ON subscriptions (status, current_period_end);
