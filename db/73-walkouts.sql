-- C9 walkout protection: the register a venue reports a walkout into, the audit
-- trail of every status transition, and the venue-local idle threshold that
-- drives potential-walkout detection (C9.1 -> B2.8).
--
-- Deliberately NOT modelled here: any automatic reimbursement. Sunday's coverage
-- guarantee (C9.5) is an underwriting decision, not an engineering one. The
-- lifecycle below carries a nullable `review_outcome` so a business decision can
-- be recorded later WITHOUT this schema ever promising, computing or paying a
-- covered amount. `status = 'under_review'` means "a human is looking at it".
--
-- Additive + idempotent. No existing data is modified or removed.

-- 1. Per-venue detection settings. The idle threshold is venue-local because a
-- 45-minute gap is abandonment in a fast-casual counter and normal in a tasting
-- menu. `require_qr_scan` mirrors Sunday's own precondition: the QR must have
-- been scanned during table service for the check to be in scope at all.
CREATE TABLE IF NOT EXISTS venue_walkout_settings (
  venue_id         TEXT PRIMARY KEY,
  enabled          BOOLEAN NOT NULL DEFAULT true,
  idle_minutes     INTEGER NOT NULL DEFAULT 45,
  require_qr_scan  BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE venue_walkout_settings
  DROP CONSTRAINT IF EXISTS venue_walkout_settings_idle_minutes_sane;

ALTER TABLE venue_walkout_settings
  ADD CONSTRAINT venue_walkout_settings_idle_minutes_sane
  CHECK (idle_minutes >= 5 AND idle_minutes <= 1440);

-- 2. The register itself (C9.3 + C9.6). One row per reported walkout.
--
-- `order_id` is the check. It is NOT closed or cancelled by reporting — Sunday
-- Step 1 is "leave the check open" precisely so the guest can still complete
-- payment from their phone, and this table never writes to `orders`.
--
-- `outstanding_minor` is the amount remaining on the bill AT REPORT TIME, in
-- minor units, captured from the reporter. `observed_outstanding_minor` is what
-- the server computed independently, so a later review can see divergence.
CREATE TABLE IF NOT EXISTS walkouts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                    TEXT NOT NULL,
  order_id                    UUID,
  table_key                   TEXT,
  table_label                 TEXT NOT NULL,
  outstanding_minor           BIGINT NOT NULL DEFAULT 0,
  observed_outstanding_minor  BIGINT,
  recovered_minor             BIGINT NOT NULL DEFAULT 0,
  currency                    TEXT NOT NULL DEFAULT 'KES',
  status                      TEXT NOT NULL DEFAULT 'open',
  review_outcome              TEXT,
  source                      TEXT NOT NULL DEFAULT 'dashboard',
  note                        TEXT,
  qr_scanned_at               TIMESTAMPTZ,
  idle_minutes_at_report      INTEGER,
  reported_by                 TEXT,
  reported_by_name            TEXT,
  reported_by_role            TEXT,
  recovered_payment_id        TEXT,
  resolved_at                 TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE walkouts
  DROP CONSTRAINT IF EXISTS walkouts_status_known;

-- open        -> reported, check still open, guest may still pay
-- under_review-> submitted for an eligibility decision by the business
-- recovered   -> the guest paid; the check closed automatically (C9.4)
-- written_off -> the venue absorbed the loss
-- dismissed   -> reported in error
ALTER TABLE walkouts
  ADD CONSTRAINT walkouts_status_known
  CHECK (status IN ('open', 'under_review', 'recovered', 'written_off', 'dismissed'));

ALTER TABLE walkouts
  DROP CONSTRAINT IF EXISTS walkouts_source_known;

ALTER TABLE walkouts
  ADD CONSTRAINT walkouts_source_known
  CHECK (source IN ('dashboard', 'staff_app'));

ALTER TABLE walkouts
  DROP CONSTRAINT IF EXISTS walkouts_amounts_non_negative;

ALTER TABLE walkouts
  ADD CONSTRAINT walkouts_amounts_non_negative
  CHECK (outstanding_minor >= 0 AND recovered_minor >= 0);

CREATE INDEX IF NOT EXISTS walkouts_venue_created_idx
  ON walkouts (venue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS walkouts_venue_status_idx
  ON walkouts (venue_id, status);

CREATE INDEX IF NOT EXISTS walkouts_venue_order_idx
  ON walkouts (venue_id, order_id);

-- Idempotency: one LIVE walkout per check. A double-tap on the floor, a replayed
-- request, or the same table reported from both the dashboard and the staff app
-- converges on the existing row instead of creating a second loss record. A
-- resolved walkout does not block a genuinely new incident on the same check.
CREATE UNIQUE INDEX IF NOT EXISTS walkouts_live_per_order
  ON walkouts (venue_id, order_id)
  WHERE order_id IS NOT NULL AND status IN ('open', 'under_review');

-- 3. Audit trail. A walkout is a financial-loss record: every transition keeps
-- the actor, the roles they held, and the before/after status. Append-only by
-- convention — nothing in the application updates or deletes these rows.
CREATE TABLE IF NOT EXISTS walkout_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    TEXT NOT NULL,
  walkout_id  UUID NOT NULL,
  event       TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  actor_id    TEXT,
  actor_name  TEXT,
  actor_role  TEXT,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS walkout_events_walkout_idx
  ON walkout_events (venue_id, walkout_id, created_at);
