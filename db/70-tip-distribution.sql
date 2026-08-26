-- Sunday-parity tip distribution (roadmap B4.1, B4.2, D5.5–D5.8, D5.10).
-- Adds the three distribution models (100% direct / 100% jar / split %), the
-- per-server direct-vs-jar rule, the weekly tip-jar cadence snapshot on
-- tip_pools, and each staff member's own payout (bank) destination.
--
-- Behavioural consequences:
--   * Three constraints are dropped and re-created with a wider key. None of
--     them loses a guarantee: tip_pools_no_overlap gains `kind` so a manual
--     ad-hoc pool can no longer collide with the weekly cadence pool covering
--     the same days; tip_allocations_base_key gains `stream` so one server can
--     hold both a direct and a jar allocation in the same weekly pool; and
--     tip_payouts' status check gains 'held' for an unbanked staff member.
--     Double-paying a payment is still prevented by tip_pool_sources'
--     UNIQUE (venue_id, payment_id), which is untouched.
--   * No row is deleted and no column is dropped. Existing pools/allocations
--     backfill to kind='manual' / stream='manual' and keep their old behaviour.
--   * staff_payout_details stores the account number ONLY as AES-GCM ciphertext
--     plus a 4-digit tail for display. There is no plaintext column, so an
--     operator who loses STAFF_PAYOUT_KEY loses the ability to read the
--     destinations back — staff must re-enter them. That is deliberate.

-- 1. Venue-level tip model (D5.5 / D5.6 / D5.7).
CREATE TABLE IF NOT EXISTS venue_tip_settings (
  venue_id           TEXT PRIMARY KEY,
  model              TEXT NOT NULL DEFAULT 'direct'
                     CHECK (model IN ('direct', 'jar', 'split')),
  default_direct_pct SMALLINT NOT NULL DEFAULT 100
                     CHECK (default_direct_pct >= 0 AND default_direct_pct <= 100),
  jar_method         TEXT NOT NULL DEFAULT 'by_hours'
                     CHECK (jar_method IN ('by_hours', 'fixed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Per-server override of the direct share (D5.7 / D5.9). Absent row means
-- the venue default applies.
CREATE TABLE IF NOT EXISTS staff_tip_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    TEXT NOT NULL,
  staff_id    UUID NOT NULL,
  direct_pct  SMALLINT NOT NULL DEFAULT 100
              CHECK (direct_pct >= 0 AND direct_pct <= 100),
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_tip_rules_unique
  ON staff_tip_rules (venue_id, staff_id);
CREATE INDEX IF NOT EXISTS staff_tip_rules_venue_idx
  ON staff_tip_rules (venue_id);

-- 3. Where a staff member's money goes (B4.1). Written by the staff member
-- themselves; managers only ever read account_last4.
CREATE TABLE IF NOT EXISTS staff_payout_details (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        TEXT NOT NULL,
  staff_id        UUID NOT NULL,
  method          TEXT NOT NULL CHECK (method IN ('mpesa', 'bank')),
  account_name    TEXT NOT NULL,
  bank_name       TEXT,
  account_cipher  TEXT NOT NULL,
  account_last4   TEXT NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_payout_details_unique
  ON staff_payout_details (venue_id, staff_id);
CREATE INDEX IF NOT EXISTS staff_payout_details_venue_idx
  ON staff_payout_details (venue_id);

-- 4. Weekly cadence snapshot on the pool (D5.8). week_start is the venue-local
-- Monday that opened the collection week; scheduled_payout_at is the Monday the
-- money is due in staff accounts, and weeks_late records an S+2 slip.
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS week_start DATE;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS direct_tips BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS jar_tips BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS opens_at TIMESTAMPTZ;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS distributed_at TIMESTAMPTZ;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS distributed_by TEXT;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS jar_method TEXT;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS scheduled_payout_at TIMESTAMPTZ;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS weeks_late SMALLINT;
SELECT add_constraint_if_missing(
  'tip_pools', 'tip_pools_kind_valid',
  'CHECK (kind IN (''manual'', ''weekly''))');
SELECT add_constraint_if_missing(
  'tip_pools', 'tip_pools_model_valid',
  'CHECK (model IS NULL OR model IN (''direct'', ''jar'', ''split''))');
SELECT add_constraint_if_missing(
  'tip_pools', 'tip_pools_jar_method_valid',
  'CHECK (jar_method IS NULL OR jar_method IN (''by_hours'', ''fixed''))');
SELECT add_constraint_if_missing(
  'tip_pools', 'tip_pools_streams_nonneg',
  'CHECK (direct_tips >= 0 AND jar_tips >= 0)');
SELECT add_constraint_if_missing(
  'tip_pools', 'tip_pools_weekly_shape',
  'CHECK (kind <> ''weekly'' OR (week_start IS NOT NULL AND opens_at IS NOT NULL))');
CREATE UNIQUE INDEX IF NOT EXISTS tip_pools_weekly_unique
  ON tip_pools (venue_id, week_start) WHERE kind = 'weekly';

-- A weekly pool covers the same calendar days a manual pool may already cover,
-- so the overlap guard is now scoped per kind.
ALTER TABLE tip_pools DROP CONSTRAINT IF EXISTS tip_pools_no_overlap;
SELECT add_constraint_if_missing(
  'tip_pools', 'tip_pools_no_overlap',
  'EXCLUDE USING gist (venue_id WITH =, currency WITH =, kind WITH =, tstzrange(period_start, period_end, ''[)'') WITH &&) WHERE (period_start IS NOT NULL AND period_end IS NOT NULL)'
);

-- 5. Per-payment direct/jar split, so every displayed number is traceable to a
-- payment id (D5.1). `channel` records the capture channel for the Collection
-- breakdown.
ALTER TABLE tip_pool_sources ADD COLUMN IF NOT EXISTS direct_tip BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tip_pool_sources ADD COLUMN IF NOT EXISTS jar_tip BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tip_pool_sources ADD COLUMN IF NOT EXISTS channel TEXT;
SELECT add_constraint_if_missing(
  'tip_pool_sources', 'tip_pool_sources_split_nonneg',
  'CHECK (direct_tip >= 0 AND jar_tip >= 0)');

-- 6. An allocation now belongs to a stream. A split-model server receives one
-- direct allocation and (if the manager includes them) one jar allocation from
-- the same weekly pool.
ALTER TABLE tip_allocations ADD COLUMN IF NOT EXISTS stream TEXT NOT NULL DEFAULT 'manual';
SELECT add_constraint_if_missing(
  'tip_allocations', 'tip_allocations_stream_valid',
  'CHECK (stream IN (''manual'', ''direct'', ''jar''))');
DROP INDEX IF EXISTS tip_allocations_base_key;
CREATE UNIQUE INDEX IF NOT EXISTS tip_allocations_base_key
  ON tip_allocations (pool_id, staff_id, stream) WHERE entry_type = 'allocation';

-- 7. A payout for a staff member with no payout details is HELD, not lost. It
-- keeps its allocations reserved and is released by the next cadence run once
-- the staff member fills their details in.
ALTER TABLE tip_payouts ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
ALTER TABLE tip_payouts ADD COLUMN IF NOT EXISTS held_reason TEXT;
ALTER TABLE tip_payouts DROP CONSTRAINT IF EXISTS tip_payouts_status_check;
SELECT add_constraint_if_missing(
  'tip_payouts', 'tip_payouts_status_valid',
  'CHECK (status IN (''pending'', ''held'', ''processing'', ''confirmed'', ''failed'', ''unknown''))');
CREATE INDEX IF NOT EXISTS tip_payouts_venue_status_idx
  ON tip_payouts (venue_id, status, created_at DESC);
