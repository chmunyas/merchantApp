-- A5.4 + A5.6 — guest-initiated requests that reach the merchant as actionable
-- work items, WITHOUT giving the guest any power to move money or to delete a
-- financial record.
--
-- Deliberately NOT modelled here:
--   * No refund is created, authorised or reserved by anything in this file. A
--     `guest_refund_requests` row is a REQUEST. Money still moves only through
--     the manager-gated POST /api/refunds path, and `refund_payment_id` is the
--     back-reference a manager records AFTER doing so — so every guest-visible
--     outcome stays traceable to a real payment id.
--   * No hard delete of ledger rows. Sunday's guests can ask for erasure;
--     accounting and tax law say the transaction stays. `guest_data_requests`
--     therefore tracks REDACTION of personal identifiers, and the completed
--     redaction is recorded on the contact (`contacts.redacted_at`) rather than
--     by removing the row. Nothing in this migration deletes or updates an
--     existing row.
--
-- Additive + idempotent.

-- 1. A5.4 — guest refund requests.
CREATE TABLE IF NOT EXISTS guest_refund_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          TEXT NOT NULL,
  payment_id        TEXT NOT NULL,
  order_id          TEXT,
  requester_phone   TEXT,
  requester_email   TEXT,
  amount_minor      BIGINT NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'KES',
  reason            TEXT NOT NULL,
  detail            TEXT,
  status            TEXT NOT NULL DEFAULT 'received',
  decided_by        TEXT,
  decided_by_name   TEXT,
  decision_note     TEXT,
  decided_at        TIMESTAMPTZ,
  refund_payment_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE guest_refund_requests
  DROP CONSTRAINT IF EXISTS guest_refund_requests_status_known;

-- received     -> the guest asked; nobody has looked yet
-- acknowledged -> a manager has seen it and is dealing with the guest
-- approved     -> the venue agreed to refund; the money has NOT moved yet
-- refunded     -> a manager executed POST /api/refunds; refund_payment_id is set
-- declined     -> the venue said no, with a reason
ALTER TABLE guest_refund_requests
  ADD CONSTRAINT guest_refund_requests_status_known
  CHECK (status IN ('received', 'acknowledged', 'approved', 'refunded', 'declined'));

ALTER TABLE guest_refund_requests
  DROP CONSTRAINT IF EXISTS guest_refund_requests_amount_non_negative;

ALTER TABLE guest_refund_requests
  ADD CONSTRAINT guest_refund_requests_amount_non_negative
  CHECK (amount_minor >= 0);

CREATE INDEX IF NOT EXISTS guest_refund_requests_venue_created_idx
  ON guest_refund_requests (venue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS guest_refund_requests_venue_status_idx
  ON guest_refund_requests (venue_id, status);

-- One live request per payment: a guest re-submitting the same complaint must
-- not fan out into a queue of duplicates for the floor to triage.
CREATE UNIQUE INDEX IF NOT EXISTS guest_refund_requests_one_live_per_payment_key
  ON guest_refund_requests (venue_id, payment_id)
  WHERE status IN ('received', 'acknowledged', 'approved');

-- 2. A5.6 — data-subject requests (erasure / rectification).
CREATE TABLE IF NOT EXISTS guest_data_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          TEXT NOT NULL,
  kind              TEXT NOT NULL,
  subject_phone     TEXT,
  subject_email     TEXT,
  contact_id        UUID,
  requested_changes JSONB NOT NULL DEFAULT '{}',
  note              TEXT,
  status            TEXT NOT NULL DEFAULT 'received',
  handled_by        TEXT,
  handled_by_name   TEXT,
  resolution_note   TEXT,
  acknowledged_at   TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE guest_data_requests
  DROP CONSTRAINT IF EXISTS guest_data_requests_kind_known;

ALTER TABLE guest_data_requests
  ADD CONSTRAINT guest_data_requests_kind_known
  CHECK (kind IN ('erasure', 'rectification'));

ALTER TABLE guest_data_requests
  DROP CONSTRAINT IF EXISTS guest_data_requests_status_known;

ALTER TABLE guest_data_requests
  ADD CONSTRAINT guest_data_requests_status_known
  CHECK (status IN ('received', 'in_review', 'completed', 'rejected'));

CREATE INDEX IF NOT EXISTS guest_data_requests_venue_created_idx
  ON guest_data_requests (venue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS guest_data_requests_venue_status_idx
  ON guest_data_requests (venue_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS guest_data_requests_one_live_per_subject_key
  ON guest_data_requests (venue_id, kind, subject_phone)
  WHERE status IN ('received', 'in_review') AND subject_phone IS NOT NULL;

-- 3. A5.6 — the audit trail. Every transition and every redaction lands here,
-- with who did it and when, so an ISO 27001 / privacy auditor can reconstruct
-- the handling of a data-subject request without reading application logs.
CREATE TABLE IF NOT EXISTS guest_data_request_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    TEXT NOT NULL,
  request_id  UUID NOT NULL,
  action      TEXT NOT NULL,
  actor_id    TEXT,
  actor_name  TEXT,
  actor_role  TEXT,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guest_data_request_events_request_idx
  ON guest_data_request_events (venue_id, request_id, created_at DESC);

-- 4. Redaction marker on the contact. Additive and nullable: an unredacted
-- contact is simply NULL, and a fresh database behaves identically to a
-- migrated one.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS contacts_venue_redacted_idx
  ON contacts (venue_id, redacted_at)
  WHERE redacted_at IS NOT NULL;
