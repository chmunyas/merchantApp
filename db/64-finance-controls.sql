-- Phase 5 finance controls: invoice validity/delivery ordering, tip allocation
-- periods and payout evidence, single-currency estimate batches, and audit anchors.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION add_constraint_if_missing(
  table_name text,
  constraint_name text,
  definition text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = constraint_name AND conrelid = table_name::regclass
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',
                   table_name, constraint_name, definition);
  END IF;
END;
$$;

-- Public invoice numbers must resolve globally, not ambiguously across venues.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoices GROUP BY number HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'duplicate public invoice numbers require operator remediation';
  END IF;
  IF EXISTS (SELECT 1 FROM invoices WHERE amount <= 0 OR amount_paid < 0 OR amount_paid > amount) THEN
    RAISE EXCEPTION 'invalid invoice balances require operator remediation';
  END IF;
  IF EXISTS (SELECT 1 FROM invoices WHERE upper(currency) <> 'KES') THEN
    RAISE EXCEPTION 'non-KES invoices require operator remediation before KES-only controls';
  END IF;
END;
$$;
UPDATE invoices SET currency = upper(currency),
  status = CASE WHEN status = 'sent' THEN 'sent' ELSE status END;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_public_number_key ON invoices (number);
INSERT INTO ledger_accounts (code, name, type, normal_side, sort_order)
VALUES ('2200','Customer Credits','liability','credit',65)
ON CONFLICT (code) DO NOTHING;

SELECT add_constraint_if_missing('invoices','invoices_amount_positive','CHECK (amount > 0)');
SELECT add_constraint_if_missing('invoices','invoices_paid_range','CHECK (amount_paid >= 0 AND amount_paid <= amount)');
SELECT add_constraint_if_missing('invoices','invoices_currency_kes','CHECK (currency = ''KES'')');
SELECT add_constraint_if_missing('invoices','invoices_tax_range','CHECK (tax_rate >= 0 AND tax_rate <= 100 AND tax_amount >= 0)');
SELECT add_constraint_if_missing('invoices','invoices_status_valid','CHECK (status IN (''draft'',''issued'',''sent'',''partial'',''paid'',''void''))');

SELECT add_constraint_if_missing('recurring_invoices','recurring_amount_positive','CHECK (amount > 0)');
SELECT add_constraint_if_missing('recurring_invoices','recurring_currency_kes','CHECK (currency = ''KES'')');
SELECT add_constraint_if_missing('recurring_invoices','recurring_cadence_valid','CHECK (cadence IN (''weekly'',''monthly''))');
SELECT add_constraint_if_missing('recurring_invoices','recurring_due_days_valid','CHECK (due_days BETWEEN 0 AND 365)');

CREATE TABLE IF NOT EXISTS invoice_payment_holds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES invoices(id),
  venue_id        TEXT NOT NULL,
  payment_intent_id UUID NOT NULL REFERENCES payment_intents(id),
  amount          BIGINT NOT NULL CHECK (amount > 0),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','consumed','released','expired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  UNIQUE (payment_intent_id)
);
CREATE INDEX IF NOT EXISTS invoice_payment_holds_live_idx
  ON invoice_payment_holds (invoice_id, status, expires_at);

CREATE TABLE IF NOT EXISTS invoice_communication_outbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES invoices(id),
  venue_id        TEXT NOT NULL,
  purpose         TEXT NOT NULL CHECK (purpose IN ('initial','reminder','resend')),
  channel         TEXT NOT NULL,
  recipient       TEXT NOT NULL,
  dedupe_key      TEXT NOT NULL UNIQUE,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','accepted','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  claim_token     UUID,
  lease_expires_at TIMESTAMPTZ,
  provider_id     TEXT,
  last_error      TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_communication_due_idx
  ON invoice_communication_outbox (next_attempt_at, created_at)
  WHERE status IN ('pending','failed','processing');

CREATE TABLE IF NOT EXISTS invoice_voids (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES invoices(id),
  venue_id        TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  reason          TEXT NOT NULL,
  actor           TEXT NOT NULL,
  subtotal        BIGINT NOT NULL CHECK (subtotal >= 0),
  tax_amount      BIGINT NOT NULL CHECK (tax_amount >= 0),
  currency        TEXT NOT NULL CHECK (currency = 'KES'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, invoice_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS recurring_invoice_occurrences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id     UUID NOT NULL REFERENCES recurring_invoices(id),
  scheduled_for   TIMESTAMPTZ NOT NULL,
  invoice_id      UUID REFERENCES invoices(id),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','created','failed')),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, scheduled_for)
);

ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'KES';
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS gross_tips BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS refunded_tips BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS net_tips BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
UPDATE tip_pools SET rule = 'equal' WHERE rule NOT IN ('direct','equal','by_hours','fixed');
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tip_allocations
    WHERE pool_id IS NOT NULL AND staff_id IS NOT NULL
    GROUP BY pool_id, staff_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate legacy tip allocations require operator remediation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM shifts WHERE status='open' AND staff_id IS NOT NULL
    GROUP BY venue_id, staff_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate open staff shifts require operator remediation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tip_pools a JOIN tip_pools b
      ON a.id < b.id AND a.venue_id = b.venue_id
     AND a.currency = b.currency
     AND a.period_start IS NOT NULL AND a.period_end IS NOT NULL
     AND b.period_start IS NOT NULL AND b.period_end IS NOT NULL
     AND tstzrange(a.period_start,a.period_end,'[)') &&
         tstzrange(b.period_start,b.period_end,'[)')
  ) THEN
    RAISE EXCEPTION 'overlapping legacy tip pools require operator remediation';
  END IF;
END;
$$;
SELECT add_constraint_if_missing('tip_pools','tip_pools_period_valid','CHECK ((period_start IS NULL AND period_end IS NULL) OR (period_start IS NOT NULL AND period_end > period_start))');
SELECT add_constraint_if_missing('tip_pools','tip_pools_rule_valid','CHECK (rule IN (''direct'',''equal'',''by_hours'',''fixed''))');
SELECT add_constraint_if_missing('tip_pools','tip_pools_currency_kes','CHECK (currency = ''KES'')');
CREATE UNIQUE INDEX IF NOT EXISTS tip_pools_idempotency_idx
  ON tip_pools (venue_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
SELECT add_constraint_if_missing(
  'tip_pools', 'tip_pools_no_overlap',
  'EXCLUDE USING gist (venue_id WITH =, currency WITH =, tstzrange(period_start, period_end, ''[)'') WITH &&) WHERE (period_start IS NOT NULL AND period_end IS NOT NULL)'
);

CREATE TABLE IF NOT EXISTS tip_pool_sources (
  pool_id         UUID NOT NULL REFERENCES tip_pools(id),
  venue_id        TEXT NOT NULL,
  payment_id      TEXT NOT NULL,
  gross_tip       BIGINT NOT NULL CHECK (gross_tip >= 0),
  refunded_tip    BIGINT NOT NULL DEFAULT 0 CHECK (refunded_tip >= 0),
  net_tip         BIGINT NOT NULL CHECK (net_tip >= 0),
  staff_id        UUID,
  PRIMARY KEY (pool_id, payment_id),
  UNIQUE (venue_id, payment_id)
);

ALTER TABLE tip_allocations ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'allocation';
ALTER TABLE tip_allocations ADD COLUMN IF NOT EXISTS correction_of UUID;
ALTER TABLE tip_allocations ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE tip_allocations ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'KES';
SELECT add_constraint_if_missing('tip_allocations','tip_allocations_type_valid','CHECK (entry_type IN (''allocation'',''correction''))');
SELECT add_constraint_if_missing('tip_allocations','tip_allocations_currency_kes','CHECK (currency = ''KES'')');
CREATE UNIQUE INDEX IF NOT EXISTS tip_allocations_base_key
  ON tip_allocations (pool_id, staff_id) WHERE entry_type = 'allocation';
CREATE UNIQUE INDEX IF NOT EXISTS tip_allocations_correction_key
  ON tip_allocations (pool_id, staff_id, source_id)
  WHERE entry_type = 'correction' AND source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tip_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        TEXT NOT NULL,
  staff_id        UUID,
  currency        TEXT NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','confirmed','failed','unknown')),
  amount          BIGINT NOT NULL CHECK (amount > 0),
  idempotency_key TEXT NOT NULL,
  requested_by    TEXT NOT NULL,
  provider_ref    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ,
  UNIQUE (venue_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS tip_payout_items (
  payout_id       UUID NOT NULL REFERENCES tip_payouts(id),
  allocation_id   UUID NOT NULL REFERENCES tip_allocations(id),
  amount          BIGINT NOT NULL CHECK (amount > 0),
  PRIMARY KEY (payout_id, allocation_id),
  UNIQUE (allocation_id)
);

CREATE TABLE IF NOT EXISTS tip_payout_evidence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id       UUID NOT NULL REFERENCES tip_payouts(id),
  provider_event_id TEXT NOT NULL UNIQUE,
  provider_ref    TEXT NOT NULL,
  amount          BIGINT NOT NULL CHECK (amount > 0),
  currency        TEXT NOT NULL CHECK (currency = 'KES'),
  evidence        JSONB NOT NULL,
  verified_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE settlements ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'KES';
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS basis TEXT NOT NULL DEFAULT 'internal_estimate';
SELECT add_constraint_if_missing('settlements','settlements_currency_kes','CHECK (currency = ''KES'')');
SELECT add_constraint_if_missing('settlements','settlements_basis_valid','CHECK (basis IN (''internal_estimate'',''provider_evidence''))');

CREATE OR REPLACE FUNCTION enforce_append_once_settlement_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.settlement_id IS NOT NULL AND NEW.settlement_id IS DISTINCT FROM OLD.settlement_id THEN
    RAISE EXCEPTION 'payment settlement membership is append-once';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payments_settlement_append_once ON payments;
CREATE TRIGGER payments_settlement_append_once
BEFORE UPDATE OF settlement_id ON payments
FOR EACH ROW EXECUTE FUNCTION enforce_append_once_settlement_membership();

CREATE TABLE IF NOT EXISTS provider_evidence_imports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        TEXT NOT NULL,
  provider        TEXT NOT NULL,
  provider_account TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  raw_evidence    JSONB NOT NULL,
  imported_by     TEXT NOT NULL,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, provider, provider_account, source_id),
  UNIQUE (venue_id, provider, content_hash)
);

CREATE TABLE IF NOT EXISTS provider_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_import_id UUID NOT NULL REFERENCES provider_evidence_imports(id),
  venue_id        TEXT NOT NULL,
  provider        TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  currency        TEXT NOT NULL CHECK (currency = 'KES'),
  status          TEXT NOT NULL CHECK (status IN ('pending','paid','failed','cancelled')),
  gross           BIGINT NOT NULL CHECK (gross >= 0),
  refunds         BIGINT NOT NULL DEFAULT 0 CHECK (refunds >= 0),
  fees            BIGINT NOT NULL DEFAULT 0 CHECK (fees >= 0),
  fee_credits     BIGINT NOT NULL DEFAULT 0 CHECK (fee_credits >= 0),
  adjustments     BIGINT NOT NULL DEFAULT 0,
  net             BIGINT NOT NULL,
  bank_reference  TEXT,
  occurred_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, provider, external_id)
);

CREATE TABLE IF NOT EXISTS provider_settlement_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id       UUID NOT NULL REFERENCES provider_payouts(id),
  venue_id        TEXT NOT NULL,
  line_type       TEXT NOT NULL CHECK (line_type IN ('capture','refund','fee','fee_credit','adjustment','transfer')),
  provider_reference TEXT NOT NULL,
  amount          BIGINT NOT NULL CHECK (amount >= 0),
  currency        TEXT NOT NULL CHECK (currency = 'KES'),
  occurred_at     TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}',
  UNIQUE (payout_id, line_type, provider_reference)
);

CREATE TABLE IF NOT EXISTS reconciliation_matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        TEXT NOT NULL,
  provider_line_id UUID NOT NULL REFERENCES provider_settlement_lines(id),
  local_type      TEXT NOT NULL CHECK (local_type IN ('payment','refund')),
  local_id        TEXT NOT NULL,
  amount          BIGINT NOT NULL CHECK (amount > 0),
  method          TEXT NOT NULL DEFAULT 'exact_reference',
  matched_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverses_match_id UUID REFERENCES reconciliation_matches(id),
  UNIQUE (provider_line_id, local_type, local_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_provider_line_active_key
  ON reconciliation_matches (provider_line_id) WHERE reverses_match_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_local_active_key
  ON reconciliation_matches (venue_id, local_type, local_id)
  WHERE reverses_match_id IS NULL;

CREATE TABLE IF NOT EXISTS ledger_period_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        TEXT NOT NULL,
  period_end      DATE NOT NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN ('closed','reopened','superseded')),
  actor           TEXT,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS break_minutes INTEGER NOT NULL DEFAULT 0;
SELECT add_constraint_if_missing('shifts','shifts_status_valid','CHECK (status IN (''open'',''closed''))');
SELECT add_constraint_if_missing('shifts','shifts_time_valid','CHECK (closed_at IS NULL OR closed_at >= opened_at)');
SELECT add_constraint_if_missing('shifts','shifts_break_valid','CHECK (break_minutes >= 0)');
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_per_staff
  ON shifts (venue_id, staff_id) WHERE status = 'open' AND staff_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ledger_audit_checkpoints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        TEXT NOT NULL,
  currency        TEXT NOT NULL CHECK (currency = 'KES'),
  period_end      DATE NOT NULL,
  algorithm       TEXT NOT NULL DEFAULT 'sha256-v1',
  entry_count     INTEGER NOT NULL,
  previous_hash   TEXT NOT NULL,
  final_hash      TEXT NOT NULL,
  signer_key_id   TEXT,
  signature       TEXT,
  anchor_receipt  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  supersedes      UUID REFERENCES ledger_audit_checkpoints(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_checkpoint_current_idx
  ON ledger_audit_checkpoints (venue_id, currency, period_end, final_hash);

DROP TRIGGER IF EXISTS invoice_voids_append_only ON invoice_voids;
CREATE TRIGGER invoice_voids_append_only
BEFORE UPDATE OR DELETE ON invoice_voids
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();
DROP TRIGGER IF EXISTS tip_pools_append_only ON tip_pools;
CREATE TRIGGER tip_pools_append_only
BEFORE UPDATE OR DELETE ON tip_pools
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();
DROP TRIGGER IF EXISTS tip_pool_sources_append_only ON tip_pool_sources;
CREATE TRIGGER tip_pool_sources_append_only
BEFORE UPDATE OR DELETE ON tip_pool_sources
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();
DROP TRIGGER IF EXISTS tip_allocations_append_only ON tip_allocations;
CREATE TRIGGER tip_allocations_append_only
BEFORE UPDATE OR DELETE ON tip_allocations
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();
DROP TRIGGER IF EXISTS tip_payout_evidence_append_only ON tip_payout_evidence;
CREATE TRIGGER tip_payout_evidence_append_only
BEFORE UPDATE OR DELETE ON tip_payout_evidence
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();
DROP TRIGGER IF EXISTS ledger_period_events_append_only ON ledger_period_events;
CREATE TRIGGER ledger_period_events_append_only
BEFORE UPDATE OR DELETE ON ledger_period_events
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();
DROP TRIGGER IF EXISTS ledger_checkpoints_append_only ON ledger_audit_checkpoints;
CREATE TRIGGER ledger_checkpoints_append_only
BEFORE UPDATE OR DELETE ON ledger_audit_checkpoints
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();
DROP TRIGGER IF EXISTS provider_evidence_append_only ON provider_evidence_imports;
CREATE TRIGGER provider_evidence_append_only
BEFORE UPDATE OR DELETE ON provider_evidence_imports
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();
DROP TRIGGER IF EXISTS provider_payouts_append_only ON provider_payouts;
CREATE TRIGGER provider_payouts_append_only
BEFORE UPDATE OR DELETE ON provider_payouts
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();
DROP TRIGGER IF EXISTS provider_lines_append_only ON provider_settlement_lines;
CREATE TRIGGER provider_lines_append_only
BEFORE UPDATE OR DELETE ON provider_settlement_lines
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();
DROP TRIGGER IF EXISTS reconciliation_matches_append_only ON reconciliation_matches;
CREATE TRIGGER reconciliation_matches_append_only
BEFORE UPDATE OR DELETE ON reconciliation_matches
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();
DROP TRIGGER IF EXISTS settlements_append_only ON settlements;
CREATE TRIGGER settlements_append_only
BEFORE UPDATE OR DELETE ON settlements
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();
DROP TRIGGER IF EXISTS settlement_adjustments_append_only ON settlement_adjustments;
CREATE TRIGGER settlement_adjustments_append_only
BEFORE UPDATE OR DELETE ON settlement_adjustments
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();
DROP TRIGGER IF EXISTS settlement_applications_append_only ON settlement_adjustment_applications;
CREATE TRIGGER settlement_applications_append_only
BEFORE UPDATE OR DELETE ON settlement_adjustment_applications
FOR EACH ROW EXECUTE FUNCTION reject_financial_fact_mutation();