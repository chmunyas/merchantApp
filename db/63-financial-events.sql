-- Phase 4 durable financial events and transactional outbox.
-- The payment ledger transition and outbox enqueue happen in one transaction;
-- replay-safe consumers apply each side effect once and retain failure visibility.

CREATE TABLE IF NOT EXISTS financial_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key       TEXT NOT NULL UNIQUE,
  venue_id        TEXT NOT NULL,
  aggregate_type  TEXT NOT NULL,
  aggregate_id    TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  event_sequence  BIGINT NOT NULL DEFAULT 0,
  payload         JSONB NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS financial_events_due_idx
  ON financial_events (next_attempt_at, occurred_at)
  WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS financial_events_venue_idx
  ON financial_events (venue_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS financial_events_aggregate_sequence_idx
  ON financial_events (aggregate_type, aggregate_id, event_sequence, occurred_at);

CREATE TABLE IF NOT EXISTS financial_outbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES financial_events(id) ON DELETE CASCADE,
  consumer        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  claimed_at      TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  claim_token     UUID,
  completed_at    TIMESTAMPTZ,
  CHECK (status IN ('pending', 'processing', 'failed', 'completed')),
  UNIQUE (event_id, consumer)
);
CREATE INDEX IF NOT EXISTS financial_outbox_due_idx
  ON financial_outbox (next_attempt_at, event_id)
  WHERE status IN ('pending', 'failed', 'processing');

-- Successful consumers record one immutable completion per event/consumer.
CREATE TABLE IF NOT EXISTS financial_effects (
  event_id      UUID NOT NULL REFERENCES financial_events(id) ON DELETE CASCADE,
  consumer      TEXT NOT NULL,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail        JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (event_id, consumer)
);

-- Provider refund capacity reservation. A row is created under a payment row lock
-- before the provider call; failed calls release it, accepted calls remain pending
-- until pull/webhook settlement marks them settled.
CREATE TABLE IF NOT EXISTS refund_reservations (
  id              TEXT PRIMARY KEY,
  venue_id        TEXT NOT NULL,
  payment_id      TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  amount          BIGINT NOT NULL CHECK (amount > 0),
  status          TEXT NOT NULL DEFAULT 'reserved',
  provider_refund_id TEXT,
  request_hash    TEXT NOT NULL,
  provider_key   TEXT NOT NULL UNIQUE,
  provider_status TEXT,
  provider_response JSONB,
  submitted_at   TIMESTAMPTZ,
  last_error     TEXT,
  next_reconcile_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN
    ('reserved','submitting','unknown','pending','booked','failed','cancelled')),
  UNIQUE (venue_id, payment_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS refund_reservations_parent_idx
  ON refund_reservations (venue_id, payment_id, status);

-- Append-only reversal facts for every settled refund. Consumers can derive
-- proportional revenue/A-R, tax, tips, commission, loyalty, COGS and settlement
-- adjustments from the immutable parent/refund snapshots.
CREATE TABLE IF NOT EXISTS financial_reversals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        TEXT NOT NULL,
  refund_id       TEXT NOT NULL UNIQUE,
  payment_id      TEXT NOT NULL,
  amount          BIGINT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'KES',
  ratio_bps       INTEGER NOT NULL CHECK (ratio_bps BETWEEN 0 AND 10000),
  payload         JSONB NOT NULL DEFAULT '{}',
  source_settlement_id UUID,
  reservation_id  TEXT REFERENCES refund_reservations(id),
  provider_occurred_at TIMESTAMPTZ,
  cumulative_before BIGINT NOT NULL DEFAULT 0 CHECK (cumulative_before >= 0),
  cumulative_after  BIGINT NOT NULL DEFAULT 0 CHECK (cumulative_after >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS financial_reversals_parent_idx
  ON financial_reversals (venue_id, payment_id, created_at);

-- Immutable economic allocation captured at first success. Refund deltas are
-- always derived from this snapshot rather than mutable prices/costs/balances.
CREATE TABLE IF NOT EXISTS financial_payment_snapshots (
  payment_id       TEXT PRIMARY KEY,
  venue_id         TEXT NOT NULL,
  currency         TEXT NOT NULL,
  gross_amount     BIGINT NOT NULL CHECK (gross_amount > 0),
  principal_amount BIGINT NOT NULL CHECK (principal_amount >= 0),
  tax_amount       BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  tip_amount       BIGINT NOT NULL DEFAULT 0 CHECK (tip_amount >= 0),
  loyalty_points   INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
  commission_amount BIGINT NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  cogs_amount      BIGINT NOT NULL DEFAULT 0 CHECK (cogs_amount >= 0),
  source_type      TEXT,
  source_id        TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (principal_amount + tip_amount = gross_amount)
);

-- Original settlement membership is immutable. Refunds become negative,
-- append-only settlement adjustments and may be applied to later batches.
CREATE TABLE IF NOT EXISTS settlement_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reversal_id     UUID NOT NULL REFERENCES financial_reversals(id),
  venue_id        TEXT NOT NULL,
  payment_id      TEXT NOT NULL,
  source_settlement_id UUID,
  amount          BIGINT NOT NULL CHECK (amount > 0),
  fee_credit      BIGINT NOT NULL DEFAULT 0 CHECK (fee_credit >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reversal_id)
);

ALTER TABLE settlements ADD COLUMN IF NOT EXISTS refunds BIGINT NOT NULL DEFAULT 0;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS fee_credits BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS settlement_adjustment_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id   UUID NOT NULL REFERENCES settlement_adjustments(id),
  settlement_id   UUID NOT NULL REFERENCES settlements(id),
  amount          BIGINT NOT NULL CHECK (amount > 0),
  fee_credit      BIGINT NOT NULL DEFAULT 0 CHECK (fee_credit >= 0),
  event_key       TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS financial_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES financial_events(id),
  venue_id        TEXT NOT NULL,
  payment_id      TEXT NOT NULL,
  refund_id       TEXT NOT NULL,
  component       TEXT NOT NULL,
  amount          BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, component)
);
CREATE INDEX IF NOT EXISTS financial_adjustments_payment_idx
  ON financial_adjustments (venue_id, payment_id, component);

-- Additive projections used by replay-safe commission and loyalty consumers.
CREATE TABLE IF NOT EXISTS commission_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  venue_id        TEXT NOT NULL,
  payment_id      TEXT NOT NULL,
  refund_id       TEXT NOT NULL,
  amount          BIGINT NOT NULL CHECK (amount >= 0),
  event_id        UUID NOT NULL REFERENCES financial_events(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id)
);

CREATE TABLE IF NOT EXISTS loyalty_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        TEXT NOT NULL,
  phone           TEXT NOT NULL,
  payment_id      TEXT NOT NULL,
  refund_id       TEXT,
  points          INTEGER NOT NULL,
  event_id        UUID NOT NULL REFERENCES financial_events(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id)
);

CREATE TABLE IF NOT EXISTS financial_retry_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id       UUID NOT NULL REFERENCES financial_outbox(id),
  venue_id        TEXT NOT NULL,
  requested_by    TEXT NOT NULL,
  prior_status    TEXT NOT NULL,
  prior_attempts  INTEGER NOT NULL,
  prior_error     TEXT,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS financial_retry_audit_outbox_idx
  ON financial_retry_audit (outbox_id, requested_at DESC);

-- Phase 4 consumer tenant boundary: saved methods are venue-owned credentials.
DELETE FROM customer_payment_methods WHERE venue_id IS NULL;
ALTER TABLE customer_payment_methods ALTER COLUMN venue_id SET NOT NULL;
DROP INDEX IF EXISTS cpm_phone_method_idx;
CREATE UNIQUE INDEX IF NOT EXISTS cpm_venue_phone_method_idx
  ON customer_payment_methods (venue_id, phone, COALESCE(provider_ref, kind));

CREATE OR REPLACE FUNCTION reject_financial_fact_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS journal_entries_append_only ON journal_entries;
CREATE TRIGGER journal_entries_append_only
BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();

DROP TRIGGER IF EXISTS journal_lines_append_only ON journal_lines;
CREATE TRIGGER journal_lines_append_only
BEFORE UPDATE OR DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();

DROP TRIGGER IF EXISTS financial_reversals_append_only ON financial_reversals;
CREATE TRIGGER financial_reversals_append_only
BEFORE UPDATE OR DELETE ON financial_reversals
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();

DROP TRIGGER IF EXISTS financial_payment_snapshots_append_only ON financial_payment_snapshots;
CREATE TRIGGER financial_payment_snapshots_append_only
BEFORE UPDATE OR DELETE ON financial_payment_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();

DROP TRIGGER IF EXISTS financial_adjustments_append_only ON financial_adjustments;
CREATE TRIGGER financial_adjustments_append_only
BEFORE UPDATE OR DELETE ON financial_adjustments
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();

DROP TRIGGER IF EXISTS commission_adjustments_append_only ON commission_adjustments;
CREATE TRIGGER commission_adjustments_append_only
BEFORE UPDATE OR DELETE ON commission_adjustments
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();

DROP TRIGGER IF EXISTS loyalty_adjustments_append_only ON loyalty_adjustments;
CREATE TRIGGER loyalty_adjustments_append_only
BEFORE UPDATE OR DELETE ON loyalty_adjustments
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();
